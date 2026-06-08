export function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseUniqueFieldSets(value: string): string[][] {
  return value
    .split(";")
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) =>
      group
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean)
    );
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatTimestamp(value?: string): string {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}
