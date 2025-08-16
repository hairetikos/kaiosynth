// Minimal Scala SCL parser -> returns cents list (includes 0)
export function parseSCL(text) {
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('!'));
  if (!lines.length) return { count:12, scale: default12() };
  // first non-comment: description, second: count
  let idx = 0;
  const _desc = lines[idx++]; // unused here
  if (idx >= lines.length) return { count:12, scale: default12() };
  const declared = parseInt(lines[idx++]);
  const cents = [];
  while (idx < lines.length && cents.length < declared) {
    let token = lines[idx++];
    // Remove parenthetical comments
    token = token.replace(/\(.*?\)/g,'').trim();
    if (!token) continue;
    if (token.includes('/')) {
      const [n,d] = token.split('/').map(Number);
      if (n>0 && d>0) cents.push(1200 * Math.log2(n/d));
    } else {
      const v = parseFloat(token);
      if (!isNaN(v)) cents.push(v);
    }
  }
  // Guarantee root 0
  if (!cents.length || cents[0] !== 0) cents.unshift(0);
  // Remove duplicates > 0 that exceed octave/tritave? We keep raw; wrap usage side.
  return { count: cents.length, scale: cents };
}

export function default12() { return [
  0,100,200,300,400,500,600,700,800,900,1000,1100,1200
]; }
