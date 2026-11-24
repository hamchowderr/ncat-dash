import { beforeEach, describe, expect, test } from "vitest";
import { readStored, storedKey, writeStored } from "./stored";

describe("stored settings", () => {
  beforeEach(() => window.localStorage.clear());

  test("keys start with the product's name", () => {
    expect(storedKey("calendar-view")).toBe("takewon:calendar-view");
  });

  test("writes and reads back", () => {
    writeStored("calendar-view", "week");
    expect(readStored("calendar-view")).toBe("week");
    expect(window.localStorage.getItem("takewon:calendar-view")).toBe("week");
  });

  test("moves a value saved under the old name over to the new one", () => {
    window.localStorage.setItem("ncat-dash:share-guest", '{"name":"Ana"}');
    expect(readStored("share-guest")).toBe('{"name":"Ana"}');
    expect(window.localStorage.getItem("takewon:share-guest")).toBe('{"name":"Ana"}');
    expect(window.localStorage.getItem("ncat-dash:share-guest")).toBeNull();
  });

  test("the new key wins over an old one", () => {
    window.localStorage.setItem("ncat-dash:calendar-view", "month");
    window.localStorage.setItem("takewon:calendar-view", "week");
    expect(readStored("calendar-view")).toBe("week");
  });

  test("nothing saved reads as null", () => {
    expect(readStored("project-layout")).toBeNull();
  });
});
