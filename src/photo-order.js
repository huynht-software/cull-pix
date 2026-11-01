(function (root) {
  const modes = ['name-asc', 'name-desc', 'taken-asc', 'taken-desc'];
  function comparePhotos(a, b, mode) {
    const byName = () => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      || a.name.localeCompare(b.name);
    if (mode.startsWith('taken-')) {
      const aKnown = Number.isFinite(a.dateTaken);
      const bKnown = Number.isFinite(b.dateTaken);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && a.dateTaken !== b.dateTaken) return (a.dateTaken - b.dateTaken) * (mode === 'taken-desc' ? -1 : 1);
      return byName();
    }
    return byName() * (mode === 'name-desc' ? -1 : 1);
  }
  const api = { modes, comparePhotos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CullPhotoOrder = api;
})(globalThis);
