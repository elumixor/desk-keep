/** Something wrong in a script or formula, where it is: an error, or a warning that stops nothing. */
export interface Problem {
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly warning: boolean;
}
