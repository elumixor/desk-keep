/** The settings dialog: open or not, and the section in view. Here so the account menu and ⌘⇧, open the same one. */
class Settings {
  open = $state(false);
  section = $state("members");

  show(section?: string) {
    if (section) this.section = section;
    this.open = true;
  }
}

export const settings = new Settings();
