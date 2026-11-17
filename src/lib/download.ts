/** Saves some data to the person's computer as a JSON file with the given name. */
export function downloadJson(fileName: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address is let go.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
