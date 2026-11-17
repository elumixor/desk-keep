import { goto } from "$app/navigation";

type Spot = { path: string; pos: number };
type Cursor = { get(): number; set(pos: number): void };

/**
 * Vim's jumplist: the places the cursor was sent from (G, gg, search, `{`...) and the pages opened in this tab, in order, so
 * Ctrl+O / Ctrl+I step between them without leaving Keep.
 */
class Visits {
  private list: Spot[] = [];
  private at = -1;
  private cursor: Cursor | null = null;
  /** Where to put the cursor once the editor of the page being opened is there. */
  private wanted: number | null = null;
  /** The next cursor move is a jump. */
  armed = false;

  /** Records where the app now is; the browser's own back and forward buttons just move the position. */
  record(path: string) {
    if (!path.startsWith("/w/") || this.list[this.at]?.path === path) return;
    if (this.list[this.at - 1]?.path === path) this.at--;
    else if (this.list[this.at + 1]?.path === path) this.at++;
    else {
      this.list.splice(this.at + 1, Infinity, { path, pos: 0 });
      this.at = this.list.length - 1;
    }
  }

  /** The open editor, which reports its cursor on every move. */
  attach(cursor: Cursor) {
    this.cursor = cursor;
    if (this.wanted !== null) cursor.set(this.wanted);
    this.wanted = null;
    return () => {
      if (this.cursor === cursor) this.cursor = null;
    };
  }

  /** The cursor moved to `pos`; a jump leaves the place it came from in the list. */
  moved(pos: number) {
    const here = this.list[this.at];
    if (!here) return;
    if (this.armed && pos !== here.pos) {
      this.list.splice(this.at + 1, Infinity, { path: here.path, pos });
      this.at++;
    } else here.pos = pos;
    this.armed = false;
  }

  /** Whether there is a place to step to. */
  can(step: 1 | -1) {
    return !!this.list[this.at + step];
  }

  async go(step: 1 | -1) {
    const from = this.list[this.at];
    const to = this.list[this.at + step];
    if (!from || !to) return;
    this.at += step;
    if (to.path === from.path && this.cursor) this.cursor.set(to.pos);
    else {
      this.wanted = to.pos;
      await goto(to.path);
    }
  }
}

export const visits = new Visits();
