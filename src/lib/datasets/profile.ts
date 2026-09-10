export type DatasetColumnProfile = {
  name: string;
  inferredType: "number" | "boolean" | "date" | "text" | "empty";
  nonEmptyCount: number;
  missingCount: number;
  distinctSampleCount: number;
  examples: string[];
  topValues: Array<{ value: string; count: number }>;
  numeric?: {
    count: number;
    min: number;
    max: number;
    sum: number;
    average: number;
  };
};

export type TabularDatasetProfile = {
  profileVersion: 1;
  title: string;
  sourceType: "csv" | "xlsx";
  sheetName?: string | null;
  dataRowCount: number;
  scannedDataRowCount: number;
  sampled: boolean;
  columnCount: number;
  columns: DatasetColumnProfile[];
  limitations: string[];
};

type BuildProfileInput = {
  title: string;
  sourceType: "csv" | "xlsx";
  sheetName?: string | null;
  rows: string[][];
  totalRowCount: number;
  maxColumns: number;
  sampled: boolean;
};

const TOP_VALUE_LIMIT = 8;
const EXAMPLE_LIMIT = 4;

export function buildTabularDatasetProfile(input: BuildProfileInput): TabularDatasetProfile {
  const headers = normalizeHeaders(input.rows[0] ?? [], input.maxColumns);
  const dataRows = input.rows.slice(1);
  const columns = headers.map((header, columnIndex) => profileColumn(header, dataRows, columnIndex));
  const dataRowCount = Math.max(0, input.totalRowCount - 1);
  const sampled = input.sampled || dataRows.length < dataRowCount;
  const limitations = [
    sampled ? `Column statistics are based on ${dataRows.length.toLocaleString()} sampled rows out of ${dataRowCount.toLocaleString()} data rows.` : null,
    "Dataset profiles are read-only evidence. Socrates can summarize and calculate simple aggregates, but it does not mutate the dataset."
  ].filter((item): item is string => Boolean(item));

  return {
    profileVersion: 1,
    title: input.title,
    sourceType: input.sourceType,
    sheetName: input.sheetName ?? null,
    dataRowCount,
    scannedDataRowCount: dataRows.length,
    sampled,
    columnCount: headers.length,
    columns,
    limitations
  };
}

export function renderDatasetProfileText(profile: TabularDatasetProfile) {
  const label = profile.sheetName ? `${profile.title} / ${profile.sheetName}` : profile.title;
  const numericColumns = profile.columns.filter((column) => column.numeric);
  const missingColumns = profile.columns
    .filter((column) => column.missingCount > 0)
    .sort((a, b) => b.missingCount - a.missingCount)
    .slice(0, 8);
  return [
    `Dataset analysis profile: ${label}`,
    `Source type: ${profile.sourceType.toUpperCase()}`,
    `Rows: ${profile.dataRowCount.toLocaleString()} data rows${profile.sampled ? ` (${profile.scannedDataRowCount.toLocaleString()} scanned for stats)` : ""}`,
    `Columns: ${profile.columnCount}`,
    "",
    "Column profile:",
    ...profile.columns.slice(0, 40).map((column) => {
      const numeric = column.numeric
        ? `; min ${formatNumber(column.numeric.min)}, max ${formatNumber(column.numeric.max)}, avg ${formatNumber(column.numeric.average)}, sum ${formatNumber(column.numeric.sum)}`
        : "";
      const topValues = column.topValues.length
        ? `; top values ${column.topValues.map((item) => `${item.value} (${item.count})`).join(", ")}`
        : "";
      return `- ${column.name}: ${column.inferredType}; non-empty ${column.nonEmptyCount}; missing ${column.missingCount}; distinct sample ${column.distinctSampleCount}${numeric}${topValues}`;
    }),
    numericColumns.length ? `Numeric columns: ${numericColumns.map((column) => column.name).join(", ")}` : "Numeric columns: none detected in the scanned rows.",
    missingColumns.length ? `Columns with missing values: ${missingColumns.map((column) => `${column.name} (${column.missingCount})`).join(", ")}` : "Columns with missing values: none in scanned rows.",
    profile.limitations.length ? `Limitations: ${profile.limitations.join(" ")}` : ""
  ].join("\n").trim();
}

export function isDatasetAnalysisQuestion(question: string) {
  const lower = question.toLowerCase();
  const explicitDataset =
    /\b(dataset|data set|csv|xlsx|spreadsheet|sheet|workbook|table|tabular)\b/i.test(lower);
  if (explicitDataset) return true;

  const hasDataContext = /\b(data|rows?|columns?|records?|fields?)\b/i.test(lower);
  const hasAnalyticOperation =
    /\b(schema|missing|blank|null|average|avg|sum|total|min|max|median|most common|count|distinct|unique|group by|breakdown|distribution|filter)\b/i.test(
      lower
    );
  return hasDataContext && hasAnalyticOperation;
}

export function buildDatasetAnalysisAnswer(question: string, profiles: TabularDatasetProfile[]) {
  if (!isDatasetAnalysisQuestion(question) || profiles.length === 0) return null;
  const profile = chooseProfile(question, profiles);
  const column = chooseColumn(question, profile);
  const lower = question.toLowerCase();
  const label = profile.sheetName ? `${profile.title} / ${profile.sheetName}` : profile.title;
  const lines: string[] = [`Using the indexed dataset profile for **${label}**:`];

  if (/\b(columns?|schema|fields?)\b/.test(lower)) {
    lines.push(`- Columns (${profile.columnCount}): ${profile.columns.map((item) => `${item.name} (${item.inferredType})`).join(", ")}.`);
  } else if (/\b(rows?|records?|count)\b/.test(lower) && !column) {
    lines.push(`- Row count: ${profile.dataRowCount.toLocaleString()} data rows.`);
    lines.push(`- Stats scan: ${profile.scannedDataRowCount.toLocaleString()} rows${profile.sampled ? " sampled for fast profiling" : " fully scanned"}.`);
  } else if (/\bmissing|blank|null|empty\b/.test(lower)) {
    const missing = profile.columns
      .filter((item) => item.missingCount > 0)
      .sort((a, b) => b.missingCount - a.missingCount);
    lines.push(missing.length
      ? `- Missing values: ${missing.slice(0, 12).map((item) => `${item.name}: ${item.missingCount}`).join(", ")}.`
      : "- Missing values: none found in the scanned rows.");
  } else if (column?.numeric && /\b(avg|average|mean|sum|total|min|max)\b/.test(lower)) {
    lines.push(`- ${column.name}: count ${column.numeric.count.toLocaleString()}, min ${formatNumber(column.numeric.min)}, max ${formatNumber(column.numeric.max)}, average ${formatNumber(column.numeric.average)}, sum ${formatNumber(column.numeric.sum)}.`);
  } else if (column && /\b(top|most common|distribution|breakdown|group by|unique|distinct)\b/.test(lower)) {
    lines.push(column.topValues.length
      ? `- ${column.name} top values: ${column.topValues.map((item) => `${item.value} (${item.count})`).join(", ")}.`
      : `- ${column.name}: no repeated non-empty values were found in the scanned rows.`);
    lines.push(`- Distinct sample values: ${column.distinctSampleCount.toLocaleString()}.`);
  } else if (column) {
    lines.push(`- ${column.name}: ${column.inferredType}; non-empty ${column.nonEmptyCount.toLocaleString()}; missing ${column.missingCount.toLocaleString()}; distinct sample ${column.distinctSampleCount.toLocaleString()}.`);
    if (column.numeric) {
      lines.push(`- Numeric stats: min ${formatNumber(column.numeric.min)}, max ${formatNumber(column.numeric.max)}, average ${formatNumber(column.numeric.average)}, sum ${formatNumber(column.numeric.sum)}.`);
    }
    if (column.topValues.length) {
      lines.push(`- Top values: ${column.topValues.map((item) => `${item.value} (${item.count})`).join(", ")}.`);
    }
  } else {
    const numeric = profile.columns.filter((item) => item.numeric).slice(0, 8);
    lines.push(`- Rows: ${profile.dataRowCount.toLocaleString()} data rows. Columns: ${profile.columnCount}.`);
    lines.push(numeric.length ? `- Numeric columns detected: ${numeric.map((item) => item.name).join(", ")}.` : "- No numeric columns were detected in the scanned rows.");
    lines.push(`- Best next questions: ask for columns, missing values, top values by a column, or average/sum/min/max for a numeric column.`);
  }

  if (profile.sampled) {
    lines.push(`\nNote: this answer is intentionally fast. It uses the dataset profile from ${profile.scannedDataRowCount.toLocaleString()} scanned rows, not a full row-by-row prompt dump.`);
  }
  return {
    answer_md: lines.join("\n"),
    profile
  };
}

export function parseDatasetProfileFromMetadata(value: unknown): TabularDatasetProfile | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const profile = record?.datasetProfile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const typed = profile as TabularDatasetProfile;
  if (typed.profileVersion !== 1 || !Array.isArray(typed.columns) || typeof typed.title !== "string") return null;
  return typed;
}

function profileColumn(name: string, rows: string[][], columnIndex: number): DatasetColumnProfile {
  let missingCount = 0;
  const examples: string[] = [];
  const valueCounts = new Map<string, number>();
  let numericCount = 0;
  let numericMin = Number.POSITIVE_INFINITY;
  let numericMax = Number.NEGATIVE_INFINITY;
  let numericSum = 0;
  let booleanCount = 0;
  let dateCount = 0;

  for (const row of rows) {
    const value = normalizeCell(row[columnIndex] ?? "");
    if (!value) {
      missingCount += 1;
      continue;
    }
    if (examples.length < EXAMPLE_LIMIT && !examples.includes(value)) examples.push(value);
    valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
    const numeric = parseNumeric(value);
    if (numeric !== null) {
      numericCount += 1;
      numericMin = Math.min(numericMin, numeric);
      numericMax = Math.max(numericMax, numeric);
      numericSum += numeric;
    }
    if (/^(true|false|yes|no|y|n|0|1)$/i.test(value)) booleanCount += 1;
    if (!Number.isNaN(Date.parse(value)) && /[-/]\d{1,2}[-/]|^\d{4}-\d{2}-\d{2}/.test(value)) dateCount += 1;
  }

  const nonEmptyCount = rows.length - missingCount;
  const inferredType = inferType({ nonEmptyCount, numericCount, booleanCount, dateCount });
  const topValues = [...valueCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_VALUE_LIMIT)
    .map(([value, count]) => ({ value, count }));

  return {
    name,
    inferredType,
    nonEmptyCount,
    missingCount,
    distinctSampleCount: valueCounts.size,
    examples,
    topValues,
    numeric: numericCount > 0
      ? {
          count: numericCount,
          min: numericMin,
          max: numericMax,
          sum: numericSum,
          average: numericSum / numericCount
        }
      : undefined
  };
}

function normalizeHeaders(row: string[], maxColumns: number) {
  const headers = row.slice(0, maxColumns).map((cell, index) => normalizeCell(cell) || `Column ${index + 1}`);
  return headers.length ? headers : ["Column 1"];
}

function normalizeCell(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function parseNumeric(value: string) {
  const normalized = value.replace(/[$,%\s,]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferType(input: { nonEmptyCount: number; numericCount: number; booleanCount: number; dateCount: number }): DatasetColumnProfile["inferredType"] {
  if (input.nonEmptyCount === 0) return "empty";
  if (input.numericCount / input.nonEmptyCount >= 0.85) return "number";
  if (input.booleanCount / input.nonEmptyCount >= 0.85) return "boolean";
  if (input.dateCount / input.nonEmptyCount >= 0.7) return "date";
  return "text";
}

function chooseProfile(question: string, profiles: TabularDatasetProfile[]) {
  const lower = question.toLowerCase();
  return profiles.find((profile) =>
    lower.includes(profile.title.toLowerCase()) ||
    Boolean(profile.sheetName && lower.includes(profile.sheetName.toLowerCase()))
  ) ?? profiles[0];
}

function chooseColumn(question: string, profile: TabularDatasetProfile) {
  const lower = question.toLowerCase();
  return profile.columns
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((column) => lower.includes(column.name.toLowerCase()));
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
