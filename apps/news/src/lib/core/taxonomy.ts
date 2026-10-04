// Single source of truth for topics, sections, sensitivity families/tags, intensities and
// reader presets. Used by the classifier prompt, the database seed, preferences UI and filtering.
// Shared by the web app and the worker: relative imports only.

export const INTENSITIES = ['mention', 'description', 'graphic'] as const;
export type Intensity = (typeof INTENSITIES)[number];

/**
 * A reader's threshold for a tag: the lowest intensity that hides an article.
 * 'off' = never hide. Ordering follows INTENSITIES: 'mention' hides everything,
 * 'description' allows passing mentions, 'graphic' allows all but graphic treatment.
 */
export type Threshold = Intensity | 'off';
export const THRESHOLDS: { value: Threshold; label: string; hint: string }[] = [
	{ value: 'mention', label: 'Hide entirely', hint: 'Hide any article that touches on this.' },
	{ value: 'description', label: 'Mentions only', hint: 'Allow brief mentions; hide articles that describe it.' },
	{ value: 'graphic', label: 'Hide graphic', hint: 'Allow descriptions; hide vivid or explicit treatment.' },
	{ value: 'off', label: 'Show', hint: 'Never hide for this reason.' }
];

export function hides(threshold: Threshold, intensity: Intensity): boolean {
	return threshold !== 'off' && INTENSITIES.indexOf(intensity) >= INTENSITIES.indexOf(threshold);
}

// ---------------------------------------------------------------------------------------------
// Topics and newspaper sections

export interface Section {
	key: string;
	label: string;
}

/** Newspaper sections, in navigation order. An article's section is its primary topic's section. */
export const SECTIONS: Section[] = [
	{ key: 'news', label: 'News' },
	{ key: 'world', label: 'World' },
	{ key: 'business', label: 'Business' },
	{ key: 'science', label: 'Science & Tech' },
	{ key: 'society', label: 'Society' },
	{ key: 'culture', label: 'Culture' },
	{ key: 'sport', label: 'Sport' },
	{ key: 'life', label: 'Life' },
	{ key: 'opinion', label: 'Opinion' }
];

export interface Topic {
	key: string;
	label: string;
	description: string;
	family: string;
	section: string;
}

export interface TopicFamily {
	key: string;
	label: string;
}

export const TOPIC_FAMILIES: TopicFamily[] = [
	{ key: 'public-affairs', label: 'News & public affairs' },
	{ key: 'economy', label: 'Business & economy' },
	{ key: 'science', label: 'Science, technology & environment' },
	{ key: 'society', label: 'Health & society' },
	{ key: 'living', label: 'Culture, sport & living' },
	{ key: 'editorial', label: 'Service & editorial' }
];

export const TOPICS: Topic[] = [
	{ key: 'politics-domestic', label: 'Domestic politics', description: 'Parties, elections, parliament, legislation', family: 'public-affairs', section: 'news' },
	{ key: 'government-administration', label: 'Government', description: 'Public administration, municipalities, policy', family: 'public-affairs', section: 'news' },
	{ key: 'world-news', label: 'World news', description: 'Foreign news and international affairs', family: 'public-affairs', section: 'world' },
	{ key: 'defence-security', label: 'Defence & security', description: 'Military, defence policy, national security', family: 'public-affairs', section: 'world' },
	{ key: 'conflict-war', label: 'Conflict & war', description: 'Armed conflict and its conduct', family: 'public-affairs', section: 'world' },
	{ key: 'terrorism-extremism', label: 'Terrorism & extremism', description: 'Terrorism, violent extremism', family: 'public-affairs', section: 'world' },
	{ key: 'law-justice', label: 'Law & justice', description: 'Courts, trials, legal system, policing policy', family: 'public-affairs', section: 'news' },
	{ key: 'crime-incidents', label: 'Crime & incidents', description: 'Crime reports, accidents, emergencies', family: 'public-affairs', section: 'news' },
	{ key: 'immigration-migration', label: 'Migration', description: 'Migration, asylum, integration', family: 'public-affairs', section: 'news' },

	{ key: 'economy', label: 'Economy', description: 'Macroeconomy, indicators, economic policy', family: 'economy', section: 'business' },
	{ key: 'business-companies', label: 'Companies', description: 'Companies, industry, corporate news', family: 'economy', section: 'business' },
	{ key: 'markets-finance', label: 'Markets', description: 'Stock markets, currencies, banking, investing', family: 'economy', section: 'business' },
	{ key: 'labour-work', label: 'Work', description: 'Employment, unions, labour disputes, workplaces', family: 'economy', section: 'business' },
	{ key: 'personal-finance', label: 'Personal finance', description: 'Consumer economy, taxation, saving, borrowing', family: 'economy', section: 'business' },
	{ key: 'real-estate-housing', label: 'Housing', description: 'Housing market, construction, rentals', family: 'economy', section: 'business' },

	{ key: 'technology', label: 'Technology', description: 'IT, software, telecoms, consumer tech', family: 'science', section: 'science' },
	{ key: 'ai-data', label: 'AI & data', description: 'Artificial intelligence, data, algorithms', family: 'science', section: 'science' },
	{ key: 'science-research', label: 'Science', description: 'Research results, space, basic science', family: 'science', section: 'science' },
	{ key: 'environment-climate', label: 'Environment & climate', description: 'Climate, nature, conservation, pollution', family: 'science', section: 'science' },
	{ key: 'energy', label: 'Energy', description: 'Energy production, grids, fuel', family: 'science', section: 'business' },
	{ key: 'transport-infrastructure', label: 'Transport', description: 'Traffic, public transport, infrastructure', family: 'science', section: 'news' },

	{ key: 'health-medicine', label: 'Health', description: 'Medicine, treatments, health services', family: 'society', section: 'society' },
	{ key: 'mental-health', label: 'Mental health', description: 'Mental health and wellbeing', family: 'society', section: 'society' },
	{ key: 'education', label: 'Education', description: 'Schools, universities, learning', family: 'society', section: 'society' },
	{ key: 'social-issues', label: 'Social issues', description: 'Inequality, welfare, social policy, human rights', family: 'society', section: 'society' },
	{ key: 'religion-belief', label: 'Religion & belief', description: 'Religion, faith communities, worldview', family: 'society', section: 'society' },
	{ key: 'human-interest', label: 'Human interest', description: 'Human-interest and community stories', family: 'society', section: 'life' },

	{ key: 'sports', label: 'Sport', description: 'Results, athletes, competitions', family: 'living', section: 'sport' },
	{ key: 'arts-culture', label: 'Arts & culture', description: 'Literature, visual arts, theatre, museums, architecture', family: 'living', section: 'culture' },
	{ key: 'entertainment-media', label: 'Entertainment', description: 'Film, TV, music, games, media industry', family: 'living', section: 'culture' },
	{ key: 'celebrity', label: 'Celebrities', description: 'Celebrity news and gossip', family: 'living', section: 'culture' },
	{ key: 'lifestyle', label: 'Lifestyle', description: 'Everyday life, relationships, home, fashion', family: 'living', section: 'life' },
	{ key: 'food-drink', label: 'Food & drink', description: 'Food, cooking, restaurants, drink', family: 'living', section: 'life' },
	{ key: 'travel-tourism', label: 'Travel', description: 'Travel and tourism', family: 'living', section: 'life' },
	{ key: 'animals-pets', label: 'Animals & pets', description: 'Animals, pets, wildlife', family: 'living', section: 'life' },

	{ key: 'weather', label: 'Weather', description: 'Weather and forecasts', family: 'editorial', section: 'life' },
	{ key: 'local-news', label: 'Local news', description: 'Local and regional news', family: 'editorial', section: 'news' },
	{ key: 'obituaries', label: 'Obituaries', description: 'Deaths and memorials of notable people', family: 'editorial', section: 'society' },
	{ key: 'opinion-editorial', label: 'Opinion', description: 'Columns, editorials, letters, commentary', family: 'editorial', section: 'opinion' },
	{ key: 'analysis-explainer', label: 'Analysis', description: 'Analysis, background pieces, explainers', family: 'editorial', section: 'opinion' },
	{ key: 'fact-check', label: 'Fact checks', description: 'Fact-checking and misinformation debunking', family: 'editorial', section: 'news' },
	{ key: 'other', label: 'Other', description: 'Only when nothing else fits', family: 'editorial', section: 'news' }
];

// ---------------------------------------------------------------------------------------------
// Sensitivity

export interface SensitivityFamily {
	key: string;
	label: string;
	description: string;
}

export interface SensitivityTag {
	key: string;
	family: string;
	label: string;
	/** Neutral, clinical wording shown to readers. */
	description: string;
}

export const SENSITIVITY_FAMILIES: SensitivityFamily[] = [
	{ key: 'violence', label: 'Violence & physical harm', description: 'Assault, weapons, war, terror, cruelty, accidents' },
	{ key: 'death', label: 'Death, grief & loss', description: 'Deaths, loss of children or pregnancies, suicide, grief, disappearances' },
	{ key: 'vulnerable', label: 'Harm to the vulnerable', description: 'Abuse of children, elderly or disabled people, animals; abuse in institutions' },
	{ key: 'sexual', label: 'Sexual content & sexual violence', description: 'Sexual violence, exploitation, explicit content, harassment' },
	{ key: 'medical', label: 'Body, illness & medicine', description: 'Medical procedures, blood, serious illness, epidemics, eating disorders, pregnancy' },
	{ key: 'mental', label: 'Mental health & addiction', description: 'Psychiatric crisis, substance abuse, gambling, coercive control' },
	{ key: 'hostility', label: 'Identity-based hostility', description: 'Slurs, racism, persecution, hostility toward groups, extremist rhetoric' },
	{ key: 'phobia', label: 'Fears & phobias', description: 'Insects, snakes, rodents, heights, confined spaces, deep water, clustered holes, macabre imagery' },
	{ key: 'disaster', label: 'Disaster & existential threat', description: 'Natural and industrial disasters, climate doom, nuclear threat, economic collapse, AI threat' },
	{ key: 'crisis', label: 'Social & personal crisis', description: 'Domestic violence, family breakdown, poverty, displacement, bullying, school violence, fraud' },
	{ key: 'tone', label: 'Tone & presentation', description: 'Distressing photos, sensationalism, strong language, outrage politics, true-crime detail' }
];

export const SENSITIVITY_TAGS: SensitivityTag[] = [
	{ key: 'violence-interpersonal', family: 'violence', label: 'Assault', description: 'Assaults, fights, beatings' },
	{ key: 'weapons-shooting', family: 'violence', label: 'Weapons', description: 'Firearms, shootings, stabbings' },
	{ key: 'armed-conflict', family: 'violence', label: 'War', description: 'War, bombardment, military operations' },
	{ key: 'terror-mass-casualty', family: 'violence', label: 'Terror attacks', description: 'Terror attacks, mass-casualty events' },
	{ key: 'torture-extreme-cruelty', family: 'violence', label: 'Torture & cruelty', description: 'Torture, executions, deliberate cruelty' },
	{ key: 'accidents-injury', family: 'violence', label: 'Accidents & injuries', description: 'Traffic and workplace accidents, serious injuries' },

	{ key: 'death-general', family: 'death', label: 'Death', description: 'Deaths and fatalities' },
	{ key: 'death-of-child', family: 'death', label: 'Death of a child', description: 'Death of, or fatal harm to, a child' },
	{ key: 'pregnancy-loss-infant-death', family: 'death', label: 'Pregnancy & infant loss', description: 'Miscarriage, stillbirth, infant death' },
	{ key: 'suicide-selfharm', family: 'death', label: 'Suicide & self-harm', description: 'Suicide, suicide attempts, self-injury' },
	{ key: 'grief-bereavement', family: 'death', label: 'Grief', description: 'Mourning, funerals, accounts of loss' },
	{ key: 'missing-persons-abduction', family: 'death', label: 'Missing people', description: 'Disappearances, kidnappings, abductions' },

	{ key: 'child-abuse', family: 'vulnerable', label: 'Child abuse', description: 'Abuse, neglect or exploitation of minors' },
	{ key: 'elder-disability-abuse', family: 'vulnerable', label: 'Elder & disability abuse', description: 'Abuse or neglect of elderly or disabled people' },
	{ key: 'animal-suffering', family: 'vulnerable', label: 'Animal suffering', description: 'Animal cruelty, neglect, slaughter, animal deaths' },
	{ key: 'institutional-abuse', family: 'vulnerable', label: 'Institutional abuse', description: 'Abuse in care homes, schools, custody or religious settings' },

	{ key: 'sexual-violence', family: 'sexual', label: 'Sexual violence', description: 'Rape, sexual assault, sexual coercion' },
	{ key: 'sexual-exploitation-trafficking', family: 'sexual', label: 'Exploitation & trafficking', description: 'Trafficking, forced prostitution, grooming' },
	{ key: 'explicit-sexual-content', family: 'sexual', label: 'Explicit content', description: 'Explicit sexual description or imagery' },
	{ key: 'sexual-harassment', family: 'sexual', label: 'Sexual harassment', description: 'Harassment, misconduct, non-violent sexual wrongdoing' },

	{ key: 'graphic-medical', family: 'medical', label: 'Medical procedures', description: 'Surgery, wounds, autopsies, medical procedures' },
	{ key: 'blood-gore', family: 'medical', label: 'Blood & remains', description: 'Blood, mutilation, human remains' },
	{ key: 'serious-illness', family: 'medical', label: 'Serious illness', description: 'Cancer, terminal illness, chronic disease' },
	{ key: 'epidemic-pandemic', family: 'medical', label: 'Epidemics', description: 'Outbreaks, contagion, quarantine' },
	{ key: 'needles-medical-anxiety', family: 'medical', label: 'Needles & hospitals', description: 'Injections, blood draws, hospital settings' },
	{ key: 'body-image-eating-disorders', family: 'medical', label: 'Eating disorders', description: 'Weight, dieting, eating disorders' },
	{ key: 'pregnancy-birth-fertility', family: 'medical', label: 'Pregnancy & fertility', description: 'Childbirth, fertility treatment, abortion' },

	{ key: 'mental-health-crisis', family: 'mental', label: 'Mental health crisis', description: 'Psychiatric crisis, breakdown, involuntary care' },
	{ key: 'substance-abuse', family: 'mental', label: 'Substance abuse', description: 'Drug and alcohol abuse, overdoses' },
	{ key: 'gambling-addiction', family: 'mental', label: 'Gambling', description: 'Gambling and gambling harm' },
	{ key: 'psychological-abuse-coercion', family: 'mental', label: 'Coercive control', description: 'Coercive control, manipulation, cults' },

	{ key: 'hate-speech-slurs', family: 'hostility', label: 'Slurs', description: 'Quoted slurs, dehumanising language' },
	{ key: 'racism-ethnic-hatred', family: 'hostility', label: 'Racism', description: 'Racist incidents, ethnic persecution, genocide' },
	{ key: 'religious-persecution', family: 'hostility', label: 'Religious persecution', description: 'Persecution on religious grounds' },
	{ key: 'gender-based-hostility', family: 'hostility', label: 'Gender-based hostility', description: 'Misogyny, misandry, gender-based hatred' },
	{ key: 'lgbtq-directed-hostility', family: 'hostility', label: 'Anti-LGBTQ hostility', description: 'Hostility or violence toward LGBTQ+ people' },
	{ key: 'disability-directed-hostility', family: 'hostility', label: 'Ableism', description: 'Ableist abuse or discrimination' },
	{ key: 'extremist-propaganda', family: 'hostility', label: 'Extremist rhetoric', description: 'Reproduced extremist rhetoric or manifestos' },

	{ key: 'insects-arachnids', family: 'phobia', label: 'Insects & spiders', description: 'Insects, spiders, infestations' },
	{ key: 'snakes-reptiles', family: 'phobia', label: 'Snakes & reptiles', description: 'Snakes and reptiles' },
	{ key: 'rodents-vermin', family: 'phobia', label: 'Rodents', description: 'Rats, mice, vermin' },
	{ key: 'heights-falls', family: 'phobia', label: 'Heights & falls', description: 'Heights, falling, edges' },
	{ key: 'confined-spaces', family: 'phobia', label: 'Confined spaces', description: 'Caves, collapses, entrapment, being buried' },
	{ key: 'deep-water-drowning', family: 'phobia', label: 'Deep water & drowning', description: 'Drowning, open water, submersion' },
	{ key: 'clusters-holes', family: 'phobia', label: 'Clustered holes', description: 'Clustered holes or bumps (trypophobia)' },
	{ key: 'horror-disturbing-imagery', family: 'phobia', label: 'Macabre imagery', description: 'Horror, corpses, uncanny or macabre imagery' },

	{ key: 'natural-disaster', family: 'disaster', label: 'Natural disasters', description: 'Earthquakes, floods, storms, wildfires' },
	{ key: 'industrial-technological-disaster', family: 'disaster', label: 'Industrial disasters', description: 'Chemical, nuclear or transport disasters' },
	{ key: 'climate-doom', family: 'disaster', label: 'Climate doom', description: 'Catastrophic climate framing, ecological collapse' },
	{ key: 'nuclear-threat', family: 'disaster', label: 'Nuclear threat', description: 'Nuclear weapons, radiation threat' },
	{ key: 'economic-collapse-threat', family: 'disaster', label: 'Economic collapse', description: 'Crash, recession, mass-unemployment framing' },
	{ key: 'ai-automation-threat', family: 'disaster', label: 'AI threat', description: 'Existential or job-loss framing of automation' },

	{ key: 'domestic-violence', family: 'crisis', label: 'Domestic violence', description: 'Intimate-partner and family violence' },
	{ key: 'family-breakdown', family: 'crisis', label: 'Family breakdown', description: 'Divorce, custody disputes, estrangement' },
	{ key: 'poverty-homelessness', family: 'crisis', label: 'Poverty', description: 'Destitution, evictions, food insecurity' },
	{ key: 'displacement-refugees', family: 'crisis', label: 'Displacement', description: 'Forced migration, refugee hardship' },
	{ key: 'bullying-harassment', family: 'crisis', label: 'Bullying', description: 'Bullying, mobbing, online harassment' },
	{ key: 'school-violence', family: 'crisis', label: 'School violence', description: 'Violence in schools and colleges' },
	{ key: 'fraud-scams-financial-harm', family: 'crisis', label: 'Fraud & scams', description: 'Scams, fraud victims, financial ruin' },

	{ key: 'graphic-imagery', family: 'tone', label: 'Distressing photos', description: 'The photos themselves are distressing' },
	{ key: 'sensationalism', family: 'tone', label: 'Sensationalism', description: 'Alarmist, outrage-driven or clickbait framing' },
	{ key: 'profanity', family: 'tone', label: 'Strong language', description: 'Swearing and strong language' },
	{ key: 'political-outrage', family: 'tone', label: 'Outrage politics', description: 'High-conflict partisan rhetoric' },
	{ key: 'true-crime-detail', family: 'tone', label: 'True-crime detail', description: 'Forensic or procedural detail of real crimes' }
];

// ---------------------------------------------------------------------------------------------
// Reader presets (onboarding). Family-level thresholds, with per-tag overrides.

export interface Preset {
	key: string;
	label: string;
	description: string;
	families: Record<string, Threshold>;
	tags: Record<string, Threshold>;
}

/** Tags that are hidden entirely in every preset except "Show me the news". */
const MOST_DISTRESSING: Record<string, Threshold> = {
	'torture-extreme-cruelty': 'mention',
	'death-of-child': 'mention',
	'pregnancy-loss-infant-death': 'mention',
	'suicide-selfharm': 'mention',
	'child-abuse': 'mention',
	'sexual-violence': 'mention',
	'sexual-exploitation-trafficking': 'mention',
	'blood-gore': 'description',
	'graphic-imagery': 'description'
};

export const PRESETS: Preset[] = [
	{
		key: 'very-gentle',
		label: 'Very gentle',
		description: 'Quiet news. Violence, death, abuse and sexual violence are left out entirely; illness, crises and disasters only in passing.',
		families: {
			violence: 'mention', death: 'mention', vulnerable: 'mention', sexual: 'mention',
			medical: 'description', mental: 'description', hostility: 'description', disaster: 'description', crisis: 'description',
			phobia: 'off', tone: 'description'
		},
		tags: { ...MOST_DISTRESSING }
	},
	{
		key: 'gentle',
		label: 'Gentle',
		description: 'Most news, without the hard parts. Difficult subjects may be mentioned, but nothing is described in detail.',
		families: {
			violence: 'description', death: 'description', vulnerable: 'description', sexual: 'mention',
			medical: 'graphic', mental: 'description', hostility: 'description', disaster: 'graphic', crisis: 'description',
			phobia: 'off', tone: 'graphic'
		},
		tags: { ...MOST_DISTRESSING }
	},
	{
		key: 'balanced',
		label: 'Balanced',
		description: 'Nearly all news. Only vivid or graphic treatment is filtered, plus the most distressing subjects.',
		families: {
			violence: 'graphic', death: 'graphic', vulnerable: 'graphic', sexual: 'graphic',
			medical: 'graphic', mental: 'graphic', hostility: 'graphic', disaster: 'off', crisis: 'graphic',
			phobia: 'off', tone: 'off'
		},
		tags: { ...MOST_DISTRESSING, 'sexual-violence': 'description', 'child-abuse': 'description', 'suicide-selfharm': 'description' }
	},
	{
		key: 'all',
		label: 'Show me the news',
		description: 'No filtering by subject. You can still hide specific topics or words.',
		families: Object.fromEntries(SENSITIVITY_FAMILIES.map((f) => [f.key, 'off' as Threshold])),
		tags: {}
	}
];

/** Expands a preset into a per-tag threshold map (every tag present). */
export function presetThresholds(preset: Preset): Record<string, Threshold> {
	return Object.fromEntries(SENSITIVITY_TAGS.map((t) => [t.key, preset.tags[t.key] ?? preset.families[t.family] ?? 'off']));
}

export const TOPIC_KEYS = TOPICS.map((t) => t.key);
export const TAG_KEYS = SENSITIVITY_TAGS.map((t) => t.key);
