export function createRequestSequencer() {
  let latest = 0;

  return {
    next() {
      latest += 1;
      return latest;
    },
    isLatest(id: number) {
      return id === latest;
    },
    cancel() {
      latest += 1;
    },
  };
}

export function isSnapshotNewer(
  current: { revision: number },
  incoming: { revision: number },
): boolean {
  return incoming.revision >= current.revision;
}
