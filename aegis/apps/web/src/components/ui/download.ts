/** Saves text content as a file from the browser. */
export function downloadText(filename: string, body: string, contentType = "text/plain") {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
