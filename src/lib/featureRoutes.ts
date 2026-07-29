/** Paths belonging to the optional CVPP / ATN-1 archive feature. */
export function isAtn1Path(pathname: string): boolean {
  return pathname === '/atn1'
    || pathname.startsWith('/atn1/')
    || pathname === '/cvpp/ataskaitos'
    || pathname.startsWith('/cvpp/ataskaitos/');
}
