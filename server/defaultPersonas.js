function buildStructuredAttributes(persona) {
  return {
    Demographics: {
      Age: {
        'Specific Age': String(persona.age),
      },
      Gender: {
        'Gender Identity': persona.gender,
      },
      Location: {
        Country: persona.country,
        Prefecture: persona.prefecture,
        City: persona.city,
        'Region Type': persona.region_type,
      },
    },
    Work: {
      Occupation: persona.occupation,
      'Occupation Category': persona.occupation_category,
    },
    Lifestyle: {
      Interests: persona.interests,
      'Information Style': persona.info_style,
      'SNS Activity': persona.sns_activity,
      'Disposable Income': persona.disposable_income,
    },
    Values: {
      'Ad Attitude': persona.ad_attitude,
      Summary: persona.one_line_summary,
    },
  };
}

function createDefaultPersona(seed) {
  const now = new Date().toISOString();
  const structuredAttributes = buildStructuredAttributes(seed);
  return {
    id: crypto.randomUUID(),
    country: seed.country,
    age: seed.age,
    gender: seed.gender,
    city: seed.city,
    prefecture: seed.prefecture,
    occupation: seed.occupation,
    interests: seed.interests,
    region_type: seed.region_type,
    narrative: seed.narrative,
    structured_attributes: structuredAttributes,
    attribute_count: 11,
    name: seed.name,
    display_name: seed.display_name,
    one_line_summary: seed.one_line_summary,
    occupation_category: seed.occupation_category,
    info_style: seed.info_style,
    ad_attitude: seed.ad_attitude,
    disposable_income: seed.disposable_income,
    sns_activity: seed.sns_activity,
    is_default: true,
    is_active: true,
    generated_by: seed.generated_by,
    generation_cost_usd: null,
    created_at: now,
    updated_at: now,
  };
}

const seeds = [
  {
    name: '美雪',
    display_name: '美雪（28歳・経理）',
    one_line_summary: '業務効率と手戻り削減を重視する慎重派の経理担当。時短志向で実用的',
    country: '日本',
    age: 28,
    gender: '女性',
    city: '東京都',
    prefecture: '東京都',
    occupation: '経理',
    interests: '業務効率化ツール、家計管理、読書',
    region_type: 'metro',
    narrative:
      '東京都内の中堅企業で経理を担当する28歳。慎重で実用重視、手戻りを減らし短時間で成果を出せることを大切にしている。ITリテラシーは中程度で、初期設定が複雑だと利用開始前に離脱しやすい。最初にサンプルや結果の見通しを示してもらえると安心して前に進める。一度設定すれば自動で回る仕組みを好み、週1回の確認程度で運用できる安定性を求めている。承認ステップがあることで、AIに勝手に動かされる不安を解消できると感じている。',
    occupation_category: '会社員',
    info_style: 'news_app',
    ad_attitude: 'neutral',
    disposable_income: 'medium',
    sns_activity: 'low',
    generated_by: 'default',
  },
  {
    name: '拓也',
    display_name: '拓也（33歳・エンジニア）',
    one_line_summary: '透明性と再現性を重視する合理的なバックエンドエンジニア',
    country: '日本',
    age: 33,
    gender: '男性',
    city: '渋谷区',
    prefecture: '東京都',
    occupation: 'バックエンドエンジニア',
    interests: '技術ブログ、OSS、アーキテクチャ設計、ジム',
    region_type: 'metro',
    narrative:
      '東京のITベンチャーでバックエンドエンジニアとして働く33歳。合理性と再現性を重視し、権限や挙動が透明であること、失敗時にも復旧しやすい設計を強く好む。ブラックボックスな推論結果は信頼しにくく、ロジックの根拠や実行ログを常に確認したい。自動化そのものには前向きだが、失敗時のリカバリーが見えない設計には警戒心が強い。技術的な品質と透明性が判断基準になっている。',
    occupation_category: '会社員',
    info_style: 'news_app',
    ad_attitude: 'skeptical',
    disposable_income: 'medium',
    sns_activity: 'low',
    generated_by: 'default',
  },
  {
    name: '凛',
    display_name: '凛（22歳・大学生）',
    one_line_summary: '直感重視で探究心旺盛な大学生。難解な専門用語なしに試せることを重視',
    country: '日本',
    age: 22,
    gender: '女性',
    city: '目黒区',
    prefecture: '東京都',
    occupation: '大学生',
    interests: 'SNS、カフェ巡り、写真、トレンドチェック',
    region_type: 'metro',
    narrative:
      '都内の大学に通う22歳。探究心があり直感を大切にするタイプで、学習しながら触れるチュートリアルやサンプルを重視している。空画面で次の行動が分からないと挫折しやすく、難解な専門用語が多いと最初の一歩が踏み出せない。ステップごとの案内があれば迷わず進めるし、完成イメージが先に見えると安心して試せる。AIが承認なしに勝手に動かないことも、継続利用の大事な条件だと思っている。',
    occupation_category: '学生',
    info_style: 'sns',
    ad_attitude: 'neutral',
    disposable_income: 'low',
    sns_activity: 'high',
    generated_by: 'default',
  },
  {
    name: '陽子',
    display_name: '陽子（52歳・看護師）',
    one_line_summary: '安定性と安全性を最優先する現場重視の看護師。短時間で迷わず使えることが条件',
    country: '日本',
    age: 52,
    gender: '女性',
    city: 'さいたま市',
    prefecture: '埼玉県',
    occupation: '看護師',
    interests: '健康情報、家庭菜園、地域の集まり',
    region_type: 'metro',
    narrative:
      '埼玉県在住の52歳看護師。堅実で安全志向、短時間で迷わず操作できる安定性を最も重視している。毎回同じ場所に同じ操作があることへの安心感が強く、確認が不足している操作には不安を感じやすい。副業的な活用には関心があるものの、設定が難しいと最初の一歩が踏み出せない。自動で動いてくれる仕組みは魅力的だが、何かあった時にすぐ止められる安心感が必要だと考えている。',
    occupation_category: '会社員',
    info_style: 'traditional_media',
    ad_attitude: 'neutral',
    disposable_income: 'medium',
    sns_activity: 'low',
    generated_by: 'default',
  },
  {
    name: '蒼',
    display_name: '蒼（27歳・SaaS営業）',
    one_line_summary: '導入メリットの早期可視化を求める成果志向のSaaS営業担当',
    country: '日本',
    age: 27,
    gender: '男性',
    city: '新宿区',
    prefecture: '東京都',
    occupation: 'SaaS営業',
    interests: 'ビジネス書、業界ニュース、ゴルフ、テニス',
    region_type: 'metro',
    narrative:
      '東京のSaaS企業に勤める27歳の営業担当。成果志向でスピードを重視し、導入メリットが早く見えることを何よりも大切にしている。顧客や上司への提案に使える具体的なデータや数値が出るまでが遅いと、提案機会を逃してしまうと感じる。どのセグメントへのアプローチが最も効くのか比較できるデータが欲しく、社内説明に使えるレポートや根拠があると導入しやすい。説明のしやすさと成果の再現性が行動の判断基準になっている。',
    occupation_category: '会社員',
    info_style: 'news_app',
    ad_attitude: 'positive',
    disposable_income: 'medium',
    sns_activity: 'medium',
    generated_by: 'default',
  },
];

export function createDefaultPersonas() {
  return seeds.map(createDefaultPersona);
}
