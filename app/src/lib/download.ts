/** Trigger a download of a blob URL, revoking it afterwards. */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Download plain text content as a file. */
export function downloadText(text: string, filename: string, type: string): void {
  downloadUrl(URL.createObjectURL(new Blob([text], { type })), filename);
}
