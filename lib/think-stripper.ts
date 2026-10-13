const OPEN = '<think>';
const CLOSE = '</think>';

/** Length of the longest suffix of `text` that is a proper prefix of `tag`. */
function partialTagSuffix(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}

/**
 * Removes `<think>…</think>` spans from a streamed model response, even when a tag is
 * split across chunks. Whitespace right after a closed think block is dropped too, since
 * Qwen emits "<think>\n\n</think>\n\n" before the answer when thinking is disabled.
 */
export class ThinkStripper {
  private buffer = '';
  private inThink = false;
  private trimLeading = true;

  /** Feed a chunk; returns the text that is safe to emit now. */
  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';

    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf(CLOSE);
        if (end === -1) {
          // Drop reasoning, but keep a possible partial "</think>" for the next chunk.
          this.buffer = this.buffer.slice(
            this.buffer.length - partialTagSuffix(this.buffer, CLOSE),
          );
          break;
        }
        this.buffer = this.buffer.slice(end + CLOSE.length);
        this.inThink = false;
        this.trimLeading = true;
        continue;
      }

      if (this.trimLeading) {
        this.buffer = this.buffer.replace(/^\s+/, '');
        if (this.buffer === '') break;
      }

      const start = this.buffer.indexOf(OPEN);
      if (start !== -1) {
        out += this.emit(this.buffer.slice(0, start));
        this.buffer = this.buffer.slice(start + OPEN.length);
        this.inThink = true;
        continue;
      }

      const keep = partialTagSuffix(this.buffer, OPEN);
      out += this.emit(this.buffer.slice(0, this.buffer.length - keep));
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      break;
    }

    return out;
  }

  /** Call at end of stream; returns any held-back text that turned out not to be a tag. */
  flush(): string {
    if (this.inThink) {
      this.buffer = '';
      return '';
    }
    const rest = this.trimLeading ? this.buffer.replace(/^\s+/, '') : this.buffer;
    this.buffer = '';
    return this.emit(rest);
  }

  private emit(text: string): string {
    if (text !== '') this.trimLeading = false;
    return text;
  }
}

/** Non-streaming convenience wrapper. */
export function stripThink(text: string): string {
  const s = new ThinkStripper();
  return (s.push(text) + s.flush()).trim();
}
