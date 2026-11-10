export function csv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const cell = (value: unknown) => {
    // Keep trusted numeric values numeric. Protect spreadsheet formulas in text.
    if (typeof value === "number") return String(value);
    let text = String(value ?? "");
    if (/^\s*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
