export const DEFAULT_PREPARE_BASE_REF = "origin/main";

export interface PrepareBaseRef {
  baseRef: string;
  remoteName: string;
  branchName: string;
}

export const invalidPrepareBaseRefMessage =
  "Base ref must use remote/branch format without whitespace, empty path segments, leading or trailing slashes.";

export function parsePrepareBaseRef(
  baseRef: string
): PrepareBaseRef | undefined {
  if (baseRef !== baseRef.trim() || /\s/.test(baseRef)) {
    return undefined;
  }

  if (baseRef.startsWith("refs/")) {
    return undefined;
  }

  const separatorIndex = baseRef.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === baseRef.length - 1) {
    return undefined;
  }

  const remoteName = baseRef.slice(0, separatorIndex);
  const branchName = baseRef.slice(separatorIndex + 1);
  if (
    remoteName === "" ||
    branchName === "" ||
    branchName.startsWith("refs/") ||
    branchName.split("/").some((segment) => segment === "")
  ) {
    return undefined;
  }

  return {
    baseRef,
    remoteName,
    branchName
  };
}
