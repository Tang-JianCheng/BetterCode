// 原始终端输入的解析：把 stdin 分片还原成按键 / 粘贴事件。
// 不用 Ink 的 useInput 是因为它会把粘贴的多字符文本按控制字符整块丢弃、
// 把不认识的转义序列（如 Shift+Enter 的 CSI-u 形式）拆散后当成普通文本
// 插入，无法可靠支持粘贴与 Shift+Enter 换行。

export type RawKeyKind =
  | 'text'
  | 'paste'
  | 'return'
  | 'newline'
  | 'backspace'
  | 'delete'
  | 'tab'
  | 'shifttab'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'escape'
  | 'ignore';

export interface RawKeyEvent {
  kind: RawKeyKind;
  text?: string;
}

// 括号粘贴模式：启用后终端把粘贴内容包在 \x1b[200~ ... \x1b[201~ 之间，
// 期间所有字符（包括回车/换行）都按字面传递，避免粘贴触发提交。
export const BRACKETED_PASTE_START = '\x1b[200~';
export const BRACKETED_PASTE_END = '\x1b[201~';
export const BRACKETED_PASTE_ENABLE = '\x1b[?2004h';
export const BRACKETED_PASTE_DISABLE = '\x1b[?2004l';

// 需要识别成特定语义的转义序列；匹配顺序不影响结果，因为各序列前缀互不冲突。
const ESCAPE_SEQUENCES: ReadonlyArray<readonly [string, RawKeyKind]> = [
  ['\x1b[13;2u', 'newline'], // Shift+Enter（CSI-u）
  ['\x1b[13;3u', 'newline'], // Option/Alt+Enter（CSI-u）
  ['\x1b\r', 'newline'], // Option+Enter（ESC 前缀形式）
  ['\x1b[13;4u', 'return'], // Ctrl+Enter 仍按提交处理
  ['\x1b[A', 'up'],
  ['\x1b[B', 'down'],
  ['\x1b[C', 'right'],
  ['\x1b[D', 'left'],
  ['\x1bOA', 'up'],
  ['\x1bOB', 'down'],
  ['\x1bOC', 'right'],
  ['\x1bOD', 'left'],
  ['\x1b[3~', 'delete'],
  ['\x1b[Z', 'shifttab'], // Shift+Tab 独立于补全用的 Tab
  ['\x1b[H', 'home'],
  ['\x1b[F', 'end'],
  ['\x1b[1~', 'home'],
  ['\x1b[4~', 'end'],
  ['\x1b[7~', 'home'],
  ['\x1b[8~', 'end'],
];

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/u;

function isControlChar(char: string): boolean {
  return CONTROL_CHAR_PATTERN.test(char);
}

/**
 * 把粘贴内容里的 \r\n 与孤立 \r 统一成 \n，其余字符原样保留。
 */
export function normalizePasteNewlines(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

/**
 * 有状态的原始输入解析器。stdin 分片可能任意拆分，因此需要跨分片维护
 * 缓冲区；粘贴内容还可能跨多个分片到达。
 */
export class RawInputParser {
  private buffer = '';
  private pasteAccum = '';
  private inPaste = false;

  push(chunk: string): RawKeyEvent[] {
    const events: RawKeyEvent[] = [];
    if (this.inPaste) {
      this.consumePasteChunk(chunk, events);
      return events;
    }
    this.buffer += chunk;
    this.parseBuffer(events);
    return events;
  }

  private consumePasteChunk(chunk: string, events: RawKeyEvent[]): void {
    const endIndex = chunk.indexOf(BRACKETED_PASTE_END);
    if (endIndex === -1) {
      this.pasteAccum += chunk;
      return;
    }
    this.pasteAccum += chunk.slice(0, endIndex);
    this.inPaste = false;
    const text = this.pasteAccum;
    this.pasteAccum = '';
    events.push({ kind: 'paste', text: normalizePasteNewlines(text) });
    const rest = chunk.slice(endIndex + BRACKETED_PASTE_END.length);
    if (rest) {
      this.buffer = rest;
      this.parseBuffer(events);
    }
  }

  private parseBuffer(events: RawKeyEvent[]): void {
    while (this.buffer.length > 0) {
      if (this.buffer.startsWith(BRACKETED_PASTE_START)) {
        const rest = this.buffer.slice(BRACKETED_PASTE_START.length);
        this.buffer = '';
        this.inPaste = true;
        if (rest) this.consumePasteChunk(rest, events);
        return;
      }

      let matched = false;
      for (const [sequence, kind] of ESCAPE_SEQUENCES) {
        if (this.buffer.startsWith(sequence)) {
          events.push({ kind });
          this.buffer = this.buffer.slice(sequence.length);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 孤立的 ESC：多数终端会把转义序列作为一个分片原子发送，
      // 这里直接把单独的 ESC 当作 Esc 键处理，避免等待导致响应变慢。
      if (this.buffer === '\x1b') {
        events.push({ kind: 'escape' });
        this.buffer = '';
        return;
      }

      if (this.buffer.startsWith('\x1b')) {
        const isPrefix = ESCAPE_SEQUENCES.some(([sequence]) => (
          sequence.startsWith(this.buffer)
        ));
        if (isPrefix) return;
        // 未知转义序列：丢弃到第一个终结字节，避免垃圾文本混入输入框。
        let dropTo: number | undefined;
        if (this.buffer[1] === '[') {
          // CSI 序列终结字节是第一个 0x40–0x7E 的字符
          for (let index = 2; index < this.buffer.length; index += 1) {
            const code = this.buffer.charCodeAt(index);
            if (code >= 0x40 && code <= 0x7e) {
              dropTo = index + 1;
              break;
            }
          }
        } else if (
          this.buffer.length >= 2
          && this.buffer.charCodeAt(1) >= 0x40
          && this.buffer.charCodeAt(1) <= 0x7e
        ) {
          dropTo = 2;
        }
        if (dropTo === undefined) return; // 还没收到终结字节，等下一个分片
        this.buffer = this.buffer.slice(dropTo);
        continue;
      }

      const char = this.buffer[0]!;
      this.buffer = this.buffer.slice(1);
      if (char === '\r' || char === '\n') {
        events.push({ kind: 'return' });
      } else if (char === '\t') {
        events.push({ kind: 'tab' });
      } else if (char === '\b' || char === '\x7f') {
        // 真实终端的 Backspace 键通常发送 \x7f（DEL），Ctrl+H 发送 \b；
        // 两者都按"删除光标前"处理，前向删除键 \x1b[3~ 走 ESCAPE_SEQUENCES。
        events.push({ kind: 'backspace' });
      } else if (char === '\x03' || char === '\x02') {
        // Ctrl+C / Ctrl+B 由应用层的 useInput 处理，这里忽略
        events.push({ kind: 'ignore' });
      } else if (isControlChar(char)) {
        // 其他控制字符（如粘贴标记之外的 C0 字符）直接丢弃
        events.push({ kind: 'ignore' });
      } else {
        // 连续可打印字符合并成单个 text 事件
        let run = char;
        while (this.buffer.length > 0) {
          const next = this.buffer[0]!;
          if (next === '\x1b' || isControlChar(next)) break;
          run += next;
          this.buffer = this.buffer.slice(1);
        }
        events.push({ kind: 'text', text: run });
      }
    }
  }
}
