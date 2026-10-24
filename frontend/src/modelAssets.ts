export function modelUrl(name: string): string {
  // Keep + literal in path segments so static hosts resolve the original filenames.
  const encodedPath = name.split('/').map(part => encodeURIComponent(part).replace(/%2B/g, '+')).join('/');
  return `/models/${encodedPath}.glb`;
}
