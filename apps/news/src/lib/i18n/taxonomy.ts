// Finnish names for the taxonomy (src/lib/core/taxonomy.ts holds the keys and the English names,
// which also go into the classifier prompt). Keyed by taxonomy key; a missing key falls back to English.
import type { Threshold } from '../core/taxonomy';

interface Labelled {
	label: string;
	description: string;
}

export const SECTIONS_FI: Record<string, string> = {
	news: 'Kotimaa',
	world: 'Ulkomaat',
	business: 'Talous',
	science: 'Tiede ja tekniikka',
	society: 'Yhteiskunta',
	culture: 'Kulttuuri',
	sport: 'Urheilu',
	life: 'Elämä',
	opinion: 'Mielipide'
};

export const TOPICS_FI: Record<string, Labelled> = {
	'politics-domestic': { label: 'Kotimaan politiikka', description: 'Puolueet, vaalit, eduskunta, lainsäädäntö' },
	'government-administration': { label: 'Hallinto', description: 'Julkinen hallinto, kunnat, hallituksen toimet' },
	'world-news': { label: 'Ulkomaat', description: 'Ulkomaanuutiset ja kansainväliset suhteet' },
	'defence-security': { label: 'Puolustus ja turvallisuus', description: 'Sotilasasiat, puolustuspolitiikka, kansallinen turvallisuus' },
	'conflict-war': { label: 'Konfliktit ja sota', description: 'Aseelliset konfliktit ja sodankäynti' },
	'terrorism-extremism': { label: 'Terrorismi ja ääriliikkeet', description: 'Terrorismi, väkivaltainen ekstremismi' },
	'law-justice': { label: 'Oikeus', description: 'Tuomioistuimet, oikeudenkäynnit, oikeusjärjestelmä, poliisitoiminta' },
	'crime-incidents': { label: 'Rikokset ja onnettomuudet', description: 'Rikosuutiset, onnettomuudet, hätätilanteet' },
	'immigration-migration': { label: 'Maahanmuutto', description: 'Maahanmuutto, turvapaikat, kotoutuminen' },
	economy: { label: 'Talous', description: 'Kansantalous, talousluvut, talouspolitiikka' },
	'business-companies': { label: 'Yritykset', description: 'Yritykset, teollisuus, yritysuutiset' },
	'markets-finance': { label: 'Markkinat', description: 'Pörssi, valuutat, pankit, sijoittaminen' },
	'labour-work': { label: 'Työelämä', description: 'Työllisyys, ammattiliitot, työkiistat, työpaikat' },
	'personal-finance': { label: 'Oma talous', description: 'Kuluttajatalous, verotus, säästäminen, lainat' },
	'real-estate-housing': { label: 'Asuminen', description: 'Asuntomarkkinat, rakentaminen, vuokra-asuminen' },
	technology: { label: 'Teknologia', description: 'Tietotekniikka, ohjelmistot, tietoliikenne, kulutuselektroniikka' },
	'ai-data': { label: 'Tekoäly ja data', description: 'Tekoäly, data, algoritmit' },
	'science-research': { label: 'Tiede', description: 'Tutkimustulokset, avaruus, perustiede' },
	'environment-climate': { label: 'Ympäristö ja ilmasto', description: 'Ilmasto, luonto, luonnonsuojelu, saasteet' },
	energy: { label: 'Energia', description: 'Energiantuotanto, sähköverkot, polttoaineet' },
	'transport-infrastructure': { label: 'Liikenne', description: 'Liikenne, joukkoliikenne, infrastruktuuri' },
	'health-medicine': { label: 'Terveys', description: 'Lääketiede, hoidot, terveyspalvelut' },
	'mental-health': { label: 'Mielenterveys', description: 'Mielenterveys ja hyvinvointi' },
	education: { label: 'Koulutus', description: 'Koulut, yliopistot, oppiminen' },
	'social-issues': { label: 'Yhteiskunnalliset kysymykset', description: 'Eriarvoisuus, hyvinvointi, sosiaalipolitiikka, ihmisoikeudet' },
	'religion-belief': { label: 'Uskonto ja vakaumus', description: 'Uskonto, uskonnolliset yhteisöt, maailmankatsomus' },
	'human-interest': { label: 'Ihmiset', description: 'Ihmiskohtalot ja tarinat lähiyhteisöistä' },
	sports: { label: 'Urheilu', description: 'Tulokset, urheilijat, kilpailut' },
	'arts-culture': { label: 'Taide ja kulttuuri', description: 'Kirjallisuus, kuvataide, teatteri, museot, arkkitehtuuri' },
	'entertainment-media': { label: 'Viihde', description: 'Elokuvat, tv, musiikki, pelit, media-ala' },
	celebrity: { label: 'Julkkikset', description: 'Julkkisuutiset ja juorut' },
	lifestyle: { label: 'Elämäntapa', description: 'Arki, ihmissuhteet, koti, muoti' },
	'food-drink': { label: 'Ruoka ja juoma', description: 'Ruoka, ruoanlaitto, ravintolat, juomat' },
	'travel-tourism': { label: 'Matkailu', description: 'Matkailu ja turismi' },
	'animals-pets': { label: 'Eläimet', description: 'Eläimet, lemmikit, villieläimet' },
	weather: { label: 'Sää', description: 'Sää ja sääennusteet' },
	'local-news': { label: 'Paikallisuutiset', description: 'Paikalliset ja alueelliset uutiset' },
	obituaries: { label: 'Muistokirjoitukset', description: 'Tunnettujen ihmisten kuolemat ja muistokirjoitukset' },
	'opinion-editorial': { label: 'Mielipide', description: 'Kolumnit, pääkirjoitukset, mielipidekirjoitukset, kommentit' },
	'analysis-explainer': { label: 'Analyysi', description: 'Analyysit, taustajutut, selittävät jutut' },
	'fact-check': { label: 'Faktantarkistus', description: 'Faktantarkistukset ja virheellisen tiedon oikaisut' },
	other: { label: 'Muu', description: 'Vain kun mikään muu ei sovi' }
};

export const TOPIC_FAMILIES_FI: Record<string, string> = {
	'public-affairs': 'Uutiset ja politiikka',
	economy: 'Talous ja yritykset',
	science: 'Tiede, tekniikka ja ympäristö',
	society: 'Terveys ja yhteiskunta',
	living: 'Kulttuuri, urheilu ja vapaa-aika',
	editorial: 'Sää, mielipiteet ja muut'
};

export const SENSITIVITY_FAMILIES_FI: Record<string, Labelled> = {
	violence: { label: 'Väkivalta ja fyysinen vahinko', description: 'Pahoinpitelyt, aseet, sota, terrorismi, julmuus, onnettomuudet' },
	death: { label: 'Kuolema, suru ja menetys', description: 'Kuolemat, lapsen tai raskauden menetys, itsemurha, suru, katoamiset' },
	vulnerable: {
		label: 'Haavoittuvien kaltoinkohtelu',
		description: 'Lasten, ikääntyneiden ja vammaisten ihmisten sekä eläinten kaltoinkohtelu; kaltoinkohtelu laitoksissa'
	},
	sexual: { label: 'Seksuaalinen sisältö ja seksuaaliväkivalta', description: 'Seksuaaliväkivalta, hyväksikäyttö, avoin seksuaalinen sisältö, häirintä' },
	medical: {
		label: 'Keho, sairaus ja lääketiede',
		description: 'Lääketieteelliset toimenpiteet, veri, vakavat sairaudet, epidemiat, syömishäiriöt, raskaus'
	},
	mental: { label: 'Mielenterveys ja riippuvuudet', description: 'Psykiatriset kriisit, päihteet, rahapelit, pakottava kontrolli' },
	hostility: {
		label: 'Identiteettiin perustuva vihamielisyys',
		description: 'Solvaukset, rasismi, vaino, ryhmiin kohdistuva vihamielisyys, ääriliikkeiden retoriikka'
	},
	phobia: {
		label: 'Pelot ja fobiat',
		description: 'Hyönteiset, käärmeet, jyrsijät, korkeat paikat, ahtaat tilat, syvä vesi, reikärykelmät, makaaberit kuvat'
	},
	disaster: {
		label: 'Katastrofit ja eksistentiaaliset uhat',
		description: 'Luonnon- ja teollisuuskatastrofit, ilmastotuho, ydinuhka, talousromahdus, tekoälyn uhka'
	},
	crisis: {
		label: 'Sosiaaliset ja henkilökohtaiset kriisit',
		description: 'Lähisuhdeväkivalta, perheen hajoaminen, köyhyys, pakolaisuus, kiusaaminen, kouluväkivalta, petokset'
	},
	tone: {
		label: 'Sävy ja esitystapa',
		description: 'Järkyttävät kuvat, sensaatiohakuisuus, voimakas kielenkäyttö, kohupolitiikka, tosirikosten yksityiskohdat'
	}
};

export const TAGS_FI: Record<string, Labelled> = {
	'violence-interpersonal': { label: 'Pahoinpitely', description: 'Pahoinpitelyt, tappelut, hakkaamiset' },
	'weapons-shooting': { label: 'Aseet', description: 'Ampuma-aseet, ampumiset, puukotukset' },
	'armed-conflict': { label: 'Sota', description: 'Sota, pommitukset, sotilasoperaatiot' },
	'terror-mass-casualty': { label: 'Terrori-iskut', description: 'Terrori-iskut, tapahtumat, joissa kuolee tai loukkaantuu paljon ihmisiä' },
	'torture-extreme-cruelty': { label: 'Kidutus ja julmuus', description: 'Kidutus, teloitukset, tahallinen julmuus' },
	'accidents-injury': { label: 'Onnettomuudet ja vammat', description: 'Liikenne- ja työtapaturmat, vakavat vammat' },

	'death-general': { label: 'Kuolema', description: 'Kuolemat ja kuolonuhrit' },
	'death-of-child': { label: 'Lapsen kuolema', description: 'Lapsen kuolema tai lapselle kuolemaan johtanut vahinko' },
	'pregnancy-loss-infant-death': { label: 'Raskauden ja vauvan menetys', description: 'Keskenmeno, kohtukuolema, vauvan kuolema' },
	'suicide-selfharm': { label: 'Itsemurha ja itsensä vahingoittaminen', description: 'Itsemurhat, itsemurhayritykset, itsensä vahingoittaminen' },
	'grief-bereavement': { label: 'Suru', description: 'Sureminen, hautajaiset, kertomukset menetyksestä' },
	'missing-persons-abduction': { label: 'Kadonneet ihmiset', description: 'Katoamiset, kaappaukset, sieppaukset' },

	'child-abuse': { label: 'Lasten kaltoinkohtelu', description: 'Alaikäisten pahoinpitely, laiminlyönti tai hyväksikäyttö' },
	'elder-disability-abuse': {
		label: 'Ikääntyneiden ja vammaisten kaltoinkohtelu',
		description: 'Ikääntyneiden tai vammaisten ihmisten kaltoinkohtelu tai laiminlyönti'
	},
	'animal-suffering': { label: 'Eläinten kärsimys', description: 'Eläinrääkkäys, laiminlyönti, teurastus, eläinten kuolemat' },
	'institutional-abuse': {
		label: 'Kaltoinkohtelu laitoksissa',
		description: 'Kaltoinkohtelu hoitokodeissa, kouluissa, vankiloissa tai uskonnollisissa yhteisöissä'
	},

	'sexual-violence': { label: 'Seksuaaliväkivalta', description: 'Raiskaukset, seksuaalinen väkivalta, seksuaaliseen tekoon pakottaminen' },
	'sexual-exploitation-trafficking': {
		label: 'Hyväksikäyttö ja ihmiskauppa',
		description: 'Ihmiskauppa, pakkoprostituutio, houkuttelu seksuaalisiin tarkoituksiin'
	},
	'explicit-sexual-content': { label: 'Seksuaalisesti avoin sisältö', description: 'Seksuaalisesti avoimet kuvaukset tai kuvat' },
	'sexual-harassment': {
		label: 'Seksuaalinen häirintä',
		description: 'Häirintä, epäasiallinen käytös, muut väkivallattomat seksuaaliset loukkaukset'
	},

	'graphic-medical': { label: 'Lääketieteelliset toimenpiteet', description: 'Leikkaukset, haavat, ruumiinavaukset, lääketieteelliset toimenpiteet' },
	'blood-gore': { label: 'Veri ja ihmisjäännökset', description: 'Veri, silpominen, ihmisjäännökset' },
	'serious-illness': { label: 'Vakava sairaus', description: 'Syöpä, kuolemaan johtavat sairaudet, pitkäaikaissairaudet' },
	'epidemic-pandemic': { label: 'Epidemiat', description: 'Taudinpurkaukset, tartunnat, karanteeni' },
	'needles-medical-anxiety': { label: 'Neulat ja sairaalat', description: 'Pistokset, verikokeet, sairaalaympäristöt' },
	'body-image-eating-disorders': { label: 'Syömishäiriöt', description: 'Paino, laihduttaminen, syömishäiriöt' },
	'pregnancy-birth-fertility': { label: 'Raskaus ja hedelmällisyys', description: 'Synnytys, hedelmöityshoidot, abortti' },

	'mental-health-crisis': { label: 'Mielenterveyskriisi', description: 'Psykiatriset kriisit, romahdus, tahdosta riippumaton hoito' },
	'substance-abuse': { label: 'Päihteiden väärinkäyttö', description: 'Huumeiden ja alkoholin väärinkäyttö, yliannostukset' },
	'gambling-addiction': { label: 'Rahapelit', description: 'Rahapelaaminen ja rahapelihaitat' },
	'psychological-abuse-coercion': { label: 'Pakottava kontrolli', description: 'Pakottava kontrolli, manipulointi, lahkot' },

	'hate-speech-slurs': { label: 'Solvaukset', description: 'Lainatut solvaukset, epäinhimillistävä kieli' },
	'racism-ethnic-hatred': { label: 'Rasismi', description: 'Rasistiset välikohtaukset, etninen vaino, kansanmurha' },
	'religious-persecution': { label: 'Uskonnollinen vaino', description: 'Vaino uskonnon perusteella' },
	'gender-based-hostility': { label: 'Sukupuoleen perustuva vihamielisyys', description: 'Naisviha, miesviha, sukupuoleen perustuva viha' },
	'lgbtq-directed-hostility': { label: 'Hlbtiq-vastaisuus', description: 'Hlbtiq+-ihmisiin kohdistuva vihamielisyys tai väkivalta' },
	'disability-directed-hostility': { label: 'Ableismi', description: 'Vammaisiin ihmisiin kohdistuva solvaaminen tai syrjintä' },
	'extremist-propaganda': { label: 'Ääriliikkeiden retoriikka', description: 'Toistettu ääriliikkeiden retoriikka tai manifestit' },

	'insects-arachnids': { label: 'Hyönteiset ja hämähäkit', description: 'Hyönteiset, hämähäkit, tuholaisongelmat' },
	'snakes-reptiles': { label: 'Käärmeet ja matelijat', description: 'Käärmeet ja matelijat' },
	'rodents-vermin': { label: 'Jyrsijät', description: 'Rotat, hiiret, muut tuholaiseläimet' },
	'heights-falls': { label: 'Korkeat paikat ja putoaminen', description: 'Korkeat paikat, putoaminen, jyrkänteet' },
	'confined-spaces': { label: 'Ahtaat tilat', description: 'Luolat, sortumat, loukkuun jääminen, hautautuminen' },
	'deep-water-drowning': { label: 'Syvä vesi ja hukkuminen', description: 'Hukkuminen, avovesi, veden alle joutuminen' },
	'clusters-holes': { label: 'Reikärykelmät', description: 'Tiheät reikä- tai nystyrärykelmät (trypofobia)' },
	'horror-disturbing-imagery': { label: 'Makaaberit kuvat', description: 'Kauhu, ruumiit, kammottavat tai makaaberit kuvat' },

	'natural-disaster': { label: 'Luonnonkatastrofit', description: 'Maanjäristykset, tulvat, myrskyt, maastopalot' },
	'industrial-technological-disaster': { label: 'Teollisuuskatastrofit', description: 'Kemikaali-, ydin- tai liikennekatastrofit' },
	'climate-doom': { label: 'Ilmastotuho', description: 'Ilmastonmuutoksen esittäminen katastrofina, ekologinen romahdus' },
	'nuclear-threat': { label: 'Ydinuhka', description: 'Ydinaseet, säteilyuhka' },
	'economic-collapse-threat': { label: 'Talousromahdus', description: 'Romahduksen, laman tai joukkotyöttömyyden uhka' },
	'ai-automation-threat': { label: 'Tekoälyn uhka', description: 'Automaation esittäminen uhkana ihmiskunnalle tai työpaikoille' },

	'domestic-violence': { label: 'Lähisuhdeväkivalta', description: 'Parisuhde- ja perheväkivalta' },
	'family-breakdown': { label: 'Perheen hajoaminen', description: 'Avioerot, huoltajuuskiistat, välirikot' },
	'poverty-homelessness': { label: 'Köyhyys', description: 'Puute, häädöt, ruoan riittämättömyys' },
	'displacement-refugees': { label: 'Pakolaisuus', description: 'Pakkomuutto, pakolaisten ahdinko' },
	'bullying-harassment': { label: 'Kiusaaminen', description: 'Kiusaaminen, työpaikkakiusaaminen, verkkohäirintä' },
	'school-violence': { label: 'Kouluväkivalta', description: 'Väkivalta kouluissa ja oppilaitoksissa' },
	'fraud-scams-financial-harm': { label: 'Petokset ja huijaukset', description: 'Huijaukset, petosten uhrit, taloudellinen tuho' },

	'graphic-imagery': { label: 'Järkyttävät kuvat', description: 'Kuvat itsessään ovat järkyttäviä' },
	sensationalism: { label: 'Sensaatiohakuisuus', description: 'Pelotteleva, kohua lietsova tai klikkejä kalasteleva esitystapa' },
	profanity: { label: 'Voimakas kielenkäyttö', description: 'Kiroilu ja voimakas kielenkäyttö' },
	'political-outrage': { label: 'Kohupolitiikka', description: 'Kärjistynyt puoluepoliittinen vastakkainasettelu' },
	'true-crime-detail': { label: 'Tosirikosten yksityiskohdat', description: 'Todellisten rikosten rikostekniset tai tutkinnalliset yksityiskohdat' }
};

export const THRESHOLDS_FI: Record<Threshold, { label: string; hint: string }> = {
	mention: { label: 'Piilota kokonaan', hint: 'Piilota kaikki jutut, joissa aihe on mukana.' },
	description: { label: 'Vain maininnat', hint: 'Salli lyhyet maininnat; piilota jutut, joissa aihetta kuvataan.' },
	graphic: { label: 'Piilota rajut', hint: 'Salli kuvaukset; piilota yksityiskohtainen tai raju käsittely.' },
	off: { label: 'Näytä', hint: 'Älä koskaan piilota tästä syystä.' }
};

export const PRESETS_FI: Record<string, Labelled> = {
	'very-gentle': {
		label: 'Hyvin lempeä',
		description: 'Rauhallisia uutisia. Väkivalta, kuolema, kaltoinkohtelu ja seksuaaliväkivalta jäävät kokonaan pois; sairaudet, kriisit ja katastrofit vain ohimennen.'
	},
	gentle: {
		label: 'Lempeä',
		description: 'Useimmat uutiset ilman raskaimpia kohtia. Vaikeat aiheet voidaan mainita, mutta mitään ei kuvata yksityiskohtaisesti.'
	},
	balanced: {
		label: 'Tasapainoinen',
		description: 'Lähes kaikki uutiset. Vain yksityiskohtaiset ja rajut kuvaukset jäävät pois, samoin kaikkein raskaimmat aiheet.'
	},
	all: { label: 'Kaikki uutiset', description: 'Aiheiden mukaan ei suodateta. Voit silti piilottaa yksittäisiä aihepiirejä tai sanoja.' }
};
