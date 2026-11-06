// The editor uses CodeMirror's default CRLF/CR/LF splitting and LF text output.
// Normalize before finding a replacement, otherwise a CRLF suffix can leave
// its LF behind while the inserted CR is independently turned into another LF.
export function editorText(text) {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}
