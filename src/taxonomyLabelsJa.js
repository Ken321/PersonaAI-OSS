const COMMON_LABELS_JA = {
  Demographics: '基本属性',
  Age: '年齢',
  'Specific Age': '具体的な年齢',
  Gender: '性別',
  'Gender Identity': '性自認',
  Location: '居住地',
  Country: '国',
  Prefecture: '都道府県',
  City: '市区町村',
  'Region Type': '地域タイプ',
  Work: '仕事',
  Occupation: '職業',
  'Occupation Category': '職業カテゴリ',
  Lifestyle: 'ライフスタイル',
  Interests: '興味関心',
  'Information Style': '情報収集スタイル',
  'SNS Activity': 'SNS利用頻度',
  'Disposable Income': '可処分所得',
  Values: '価値観',
  'Ad Attitude': '広告への態度',
  Summary: '要約',
};

function humanizeLabel(label) {
  return String(label)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function translateTaxonomyLabel(label) {
  if (!label) return label;
  if (COMMON_LABELS_JA[label]) return COMMON_LABELS_JA[label];
  return humanizeLabel(label);
}
