import { expect, test } from "bun:test"
import { createDuplicateKeyGuard } from "../../src/util/key-dedupe"

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

test("accepts identical sequences inside one synchronous stdin read (bulk paste)", () => {
  const guard = createDuplicateKeyGuard()
  expect(guard("a")).toBe(false)
  expect(guard("a")).toBe(false)
  expect(guard("a")).toBe(false)
})

test("drops an identical sequence that reappears from a fresh read within the window", async () => {
  const guard = createDuplicateKeyGuard()
  expect(guard("a")).toBe(false)
  await flushMicrotasks()
  expect(guard("a")).toBe(true)
  // A further duplicate anchors on the original event and is dropped too.
  await flushMicrotasks()
  expect(guard("a")).toBe(true)
})

test("accepts an identical sequence once the duplicate window has passed", async () => {
  const guard = createDuplicateKeyGuard()
  expect(guard("a")).toBe(false)
  await flushMicrotasks()
  await Bun.sleep(10)
  expect(guard("a")).toBe(false)
})

test("accepts different sequences back to back", async () => {
  const guard = createDuplicateKeyGuard()
  expect(guard("a")).toBe(false)
  await flushMicrotasks()
  expect(guard("b")).toBe(false)
})

test("kitty-protocol repeats carry a different sequence and are accepted", async () => {
  const guard = createDuplicateKeyGuard()
  expect(guard("\x1b[97;2u")).toBe(false)
  await flushMicrotasks()
  expect(guard("\x1b[97;2u")).toBe(true)
  expect(guard("\x1b[97;2:1u")).toBe(false)
})

test("never drops terminal responses or mouse reports", () => {
  const guard = createDuplicateKeyGuard()
  for (const sequence of ["\x1b[10;20R", "\x1b[?62;c", "\x1b[?997;1n", "\x1b[4;720;1440t", "\x1b[<0;5;3M"]) {
    expect(guard(sequence)).toBe(false)
    expect(guard(sequence)).toBe(false)
  }
})
