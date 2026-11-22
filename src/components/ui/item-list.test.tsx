import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FolderRow, ItemList, ItemRow, MetaLine, Pager, pageNumbers, usePages } from "./item-list";

function Numbers({ count }: { count: number }) {
  const items = Array.from({ length: count }, (_, n) => `Item ${n + 1}`);
  const { shown, pager } = usePages(items, `test-${count}`);
  return (
    <>
      <ItemList label="Things">
        {shown.map((item) => (
          <ItemRow key={item} name={item} href={`/things/${item}`} />
        ))}
      </ItemList>
      <Pager {...pager} noun="things" />
    </>
  );
}

describe("the card-row list", () => {
  test("a row's name opens it, with its facts under it and a menu on the right", () => {
    render(
      <ItemList label="Automations">
        <FolderRow
          name="Clio"
          href="/automations?folder=c1"
          meta={<MetaLine>3 automations</MetaLine>}
        />
        <ItemRow
          name="Daily reel"
          href="/automations/a1"
          meta={
            <MetaLine>
              <span>Last updated 2 weeks ago</span>
              <span>Created 5 November</span>
            </MetaLine>
          }
          menu={<span>Open</span>}
          menuLabel="More for Daily reel"
        />
      </ItemList>,
    );
    const list = screen.getByRole("list", { name: "Automations" });
    expect(list.querySelector("[data-folder]")).toHaveTextContent("Clio");
    expect(screen.getByRole("link", { name: "Daily reel" })).toHaveAttribute(
      "href",
      "/automations/a1",
    );
    expect(screen.getByText("Created 5 November")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More for Daily reel" })).toBeInTheDocument();
  });

  test("a short list has no pages to step through", () => {
    render(<Numbers count={8} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  test("a long list comes in pages, 25 to a page", () => {
    render(<Numbers count={56} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    expect(screen.getByText("Total 56")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByRole("link", { name: "Item 26" })).toBeInTheDocument();
  });

  test("many pages show the ends and the ones around this page", () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 4, "gap", 20]);
    expect(pageNumbers(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageNumbers(20, 20)).toEqual([1, "gap", 17, 18, 19, 20]);
  });
});
