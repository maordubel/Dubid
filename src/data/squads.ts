/**
 * src/data/squads.ts — נוצר אוטומטית מ-scripts/squads.source.json.
 * אל תערכו ידנית. עדכנו את ה-JSON והריצו: npm run build:squads
 *
 * נוצר: מ-6 קבוצות · 47 שחקנים · עונת 2026/2027
 */
import type { Position } from '../lib/scoring/types.ts';

export interface TeamRow {
  id: string;
  externalId: string;
  nameHe: string;
  nameEn: string;
  short: string;
  city: string | null;
  stadium: string | null;
}

export interface PlayerRow {
  id: string;
  externalId: string;
  teamId: string;
  position: Position;
  nameHe: string;
  nameEn: string;
  shirt: number | null;
}

export const LEAGUE = {
  "code": "IL_PREMIER",
  "nameHe": "ליגת העל בישראל",
  "nameEn": "Israeli Premier League",
  "season": "2026/2027"
} as const;

/** מספר הקבוצות בליגת העל במציאות. מכאן נגזר החסם על גודל ההרכב. */
export const LEAGUE_TEAM_COUNT_REAL = 14;

export const TEAMS: TeamRow[] = [
  {
    "id": "T1",
    "externalId": "1",
    "nameHe": "מכבי חיפה",
    "nameEn": "Maccabi Haifa",
    "short": "מ״ח",
    "city": "חיפה",
    "stadium": "סמי עופר"
  },
  {
    "id": "T2",
    "externalId": "2",
    "nameHe": "מכבי תל אביב",
    "nameEn": "Maccabi Tel Aviv",
    "short": "מת״א",
    "city": "תל אביב",
    "stadium": "בלומפילד"
  },
  {
    "id": "T3",
    "externalId": "3",
    "nameHe": "הפועל באר שבע",
    "nameEn": "Hapoel Beer Sheva",
    "short": "הב״ש",
    "city": "באר שבע",
    "stadium": "טרנר"
  },
  {
    "id": "T4",
    "externalId": "4",
    "nameHe": "בית\"ר ירושלים",
    "nameEn": "Beitar Jerusalem",
    "short": "בי״ר",
    "city": "ירושלים",
    "stadium": "טדי"
  },
  {
    "id": "T5",
    "externalId": "5",
    "nameHe": "הפועל תל אביב",
    "nameEn": "Hapoel Tel Aviv",
    "short": "הת״א",
    "city": "תל אביב",
    "stadium": "בלומפילד"
  },
  {
    "id": "T6",
    "externalId": "6",
    "nameHe": "מכבי נתניה",
    "nameEn": "Maccabi Netanya",
    "short": "מ״נ",
    "city": "נתניה",
    "stadium": "נתניה"
  }
];

export const PLAYERS: PlayerRow[] = [
  {
    "id": "P101",
    "externalId": "101",
    "teamId": "T1",
    "position": "GK",
    "nameHe": "שריף כיוף",
    "nameEn": "Shareef Kayouf",
    "shirt": 40
  },
  {
    "id": "P102",
    "externalId": "102",
    "teamId": "T1",
    "position": "GK",
    "nameHe": "עומרי גלזר",
    "nameEn": "Omri Glazer",
    "shirt": 55
  },
  {
    "id": "P103",
    "externalId": "103",
    "teamId": "T1",
    "position": "DEF",
    "nameHe": "שון גולדברג",
    "nameEn": "Sean Goldberg",
    "shirt": 3
  },
  {
    "id": "P104",
    "externalId": "104",
    "teamId": "T1",
    "position": "DEF",
    "nameHe": "פדראו",
    "nameEn": "Pedrao",
    "shirt": 44
  },
  {
    "id": "P105",
    "externalId": "105",
    "teamId": "T1",
    "position": "DEF",
    "nameHe": "פייר קורנו",
    "nameEn": "Pierre Cornud",
    "shirt": 27
  },
  {
    "id": "P106",
    "externalId": "106",
    "teamId": "T1",
    "position": "DEF",
    "nameHe": "זוהר זסנו",
    "nameEn": "Zohar Zasano",
    "shirt": 2
  },
  {
    "id": "P107",
    "externalId": "107",
    "teamId": "T1",
    "position": "MID",
    "nameHe": "עלי מוחמד",
    "nameEn": "Ali Mohamed",
    "shirt": 4
  },
  {
    "id": "P108",
    "externalId": "108",
    "teamId": "T1",
    "position": "MID",
    "nameHe": "אתאן אזולאי",
    "nameEn": "Ethan Azoulay",
    "shirt": 19
  },
  {
    "id": "P109",
    "externalId": "109",
    "teamId": "T1",
    "position": "MID",
    "nameHe": "ברוניניו",
    "nameEn": "Bruninho",
    "shirt": 10
  },
  {
    "id": "P110",
    "externalId": "110",
    "teamId": "T1",
    "position": "FWD",
    "nameHe": "מנואל בנסון",
    "nameEn": "Manuel Benson",
    "shirt": 14
  },
  {
    "id": "P111",
    "externalId": "111",
    "teamId": "T1",
    "position": "FWD",
    "nameHe": "גיא מלמד",
    "nameEn": "Guy Melamed",
    "shirt": 18
  },
  {
    "id": "P201",
    "externalId": "201",
    "teamId": "T2",
    "position": "GK",
    "nameHe": "רועי משפתי",
    "nameEn": "Roi Mishpati",
    "shirt": 22
  },
  {
    "id": "P202",
    "externalId": "202",
    "teamId": "T2",
    "position": "DEF",
    "nameHe": "אופיר דוידזאדה",
    "nameEn": "Ofir Davidzada",
    "shirt": 4
  },
  {
    "id": "P203",
    "externalId": "203",
    "teamId": "T2",
    "position": "DEF",
    "nameHe": "רז שלמה",
    "nameEn": "Raz Shlomo",
    "shirt": 3
  },
  {
    "id": "P204",
    "externalId": "204",
    "teamId": "T2",
    "position": "MID",
    "nameHe": "עידו שחר",
    "nameEn": "Ido Shahar",
    "shirt": 14
  },
  {
    "id": "P205",
    "externalId": "205",
    "teamId": "T2",
    "position": "MID",
    "nameHe": "דור פרץ",
    "nameEn": "Dor Peretz",
    "shirt": 42
  },
  {
    "id": "P206",
    "externalId": "206",
    "teamId": "T2",
    "position": "MID",
    "nameHe": "גבי קניקובסקי",
    "nameEn": "Gabi Kanichowsky",
    "shirt": 16
  },
  {
    "id": "P207",
    "externalId": "207",
    "teamId": "T2",
    "position": "MID",
    "nameHe": "אייסון פטאצ'י",
    "nameEn": "Issouf Sissokho",
    "shirt": 26
  },
  {
    "id": "P208",
    "externalId": "208",
    "teamId": "T2",
    "position": "FWD",
    "nameHe": "דור תורג'מן",
    "nameEn": "Dor Turgeman",
    "shirt": 7
  },
  {
    "id": "P209",
    "externalId": "209",
    "teamId": "T2",
    "position": "FWD",
    "nameHe": "ערן זהבי",
    "nameEn": "Eran Zahavi",
    "shirt": 77
  },
  {
    "id": "P210",
    "externalId": "210",
    "teamId": "T2",
    "position": "FWD",
    "nameHe": "הנרי אדו",
    "nameEn": "Henry Addo",
    "shirt": 11
  },
  {
    "id": "P301",
    "externalId": "301",
    "teamId": "T3",
    "position": "GK",
    "nameHe": "ניב אליאסי",
    "nameEn": "Niv Eliasi",
    "shirt": 55
  },
  {
    "id": "P302",
    "externalId": "302",
    "teamId": "T3",
    "position": "DEF",
    "nameHe": "איתן טיבי",
    "nameEn": "Eitan Tibi",
    "shirt": 5
  },
  {
    "id": "P303",
    "externalId": "303",
    "teamId": "T3",
    "position": "DEF",
    "nameHe": "מיגל ויטור",
    "nameEn": "Miguel Vitor",
    "shirt": 4
  },
  {
    "id": "P304",
    "externalId": "304",
    "teamId": "T3",
    "position": "MID",
    "nameHe": "לוקאס ברטו",
    "nameEn": "Lucas Barreto",
    "shirt": 8
  },
  {
    "id": "P305",
    "externalId": "305",
    "teamId": "T3",
    "position": "MID",
    "nameHe": "קינגס קנגווה",
    "nameEn": "Kings Kangwa",
    "shirt": 22
  },
  {
    "id": "P306",
    "externalId": "306",
    "teamId": "T3",
    "position": "MID",
    "nameHe": "אליאל פרץ",
    "nameEn": "Eliel Peretz",
    "shirt": 15
  },
  {
    "id": "P307",
    "externalId": "307",
    "teamId": "T3",
    "position": "FWD",
    "nameHe": "אמוראן ששון",
    "nameEn": "Amran Sasson",
    "shirt": 9
  },
  {
    "id": "P308",
    "externalId": "308",
    "teamId": "T3",
    "position": "FWD",
    "nameHe": "חالد זייד",
    "nameEn": "Alon Turgeman",
    "shirt": 99
  },
  {
    "id": "P401",
    "externalId": "401",
    "teamId": "T4",
    "position": "GK",
    "nameHe": "מיגל סילבה",
    "nameEn": "Miguel Silva",
    "shirt": 1
  },
  {
    "id": "P402",
    "externalId": "402",
    "teamId": "T4",
    "position": "DEF",
    "nameHe": "אורי דהן",
    "nameEn": "Uri Dahan",
    "shirt": 5
  },
  {
    "id": "P403",
    "externalId": "403",
    "teamId": "T4",
    "position": "DEF",
    "nameHe": "גיל כהן",
    "nameEn": "Gil Cohen",
    "shirt": 4
  },
  {
    "id": "P404",
    "externalId": "404",
    "teamId": "T4",
    "position": "MID",
    "nameHe": "ירדן שועה",
    "nameEn": "Yarden Shua",
    "shirt": 7
  },
  {
    "id": "P405",
    "externalId": "405",
    "teamId": "T4",
    "position": "MID",
    "nameHe": "איסמעילה סורו",
    "nameEn": "Ismaila Soro",
    "shirt": 6
  },
  {
    "id": "P406",
    "externalId": "406",
    "teamId": "T4",
    "position": "MID",
    "nameHe": "דור מיכה",
    "nameEn": "Dor Micha",
    "shirt": 15
  },
  {
    "id": "P407",
    "externalId": "407",
    "teamId": "T4",
    "position": "FWD",
    "nameHe": "פטריק טוומאסי",
    "nameEn": "Patrick Twumasi",
    "shirt": 11
  },
  {
    "id": "P408",
    "externalId": "408",
    "teamId": "T4",
    "position": "FWD",
    "nameHe": "מיירון ג'ורג'",
    "nameEn": "Mayron George",
    "shirt": 99
  },
  {
    "id": "P501",
    "externalId": "501",
    "teamId": "T5",
    "position": "GK",
    "nameHe": "רובי לבקוביץ'",
    "nameEn": "Rubi Levkovich",
    "shirt": 1
  },
  {
    "id": "P502",
    "externalId": "502",
    "teamId": "T5",
    "position": "DEF",
    "nameHe": "דגלאס אווסו",
    "nameEn": "Douglas Owusu",
    "shirt": 2
  },
  {
    "id": "P503",
    "externalId": "503",
    "teamId": "T5",
    "position": "DEF",
    "nameHe": "זיו מורגן",
    "nameEn": "Ziv Morgan",
    "shirt": 25
  },
  {
    "id": "P504",
    "externalId": "504",
    "teamId": "T5",
    "position": "MID",
    "nameHe": "רן בנימין",
    "nameEn": "Ran Binyamin",
    "shirt": 6
  },
  {
    "id": "P505",
    "externalId": "505",
    "teamId": "T5",
    "position": "FWD",
    "nameHe": "אלן אוז'בולט",
    "nameEn": "Alen Ozbolt",
    "shirt": 9
  },
  {
    "id": "P601",
    "externalId": "601",
    "teamId": "T6",
    "position": "GK",
    "nameHe": "עומר ניראון",
    "nameEn": "Omer Niron",
    "shirt": 55
  },
  {
    "id": "P602",
    "externalId": "602",
    "teamId": "T6",
    "position": "DEF",
    "nameHe": "פטריק פטוצי",
    "nameEn": "Matan Baltaxa",
    "shirt": 3
  },
  {
    "id": "P603",
    "externalId": "603",
    "teamId": "T6",
    "position": "DEF",
    "nameHe": "ג'אבר קארם",
    "nameEn": "Karem Jaber",
    "shirt": 2
  },
  {
    "id": "P604",
    "externalId": "604",
    "teamId": "T6",
    "position": "MID",
    "nameHe": "מקסים פלקושצ'נקו",
    "nameEn": "Maxim Plakuschenko",
    "shirt": 10
  },
  {
    "id": "P605",
    "externalId": "605",
    "teamId": "T6",
    "position": "FWD",
    "nameHe": "איגור זלאטנוביץ'",
    "nameEn": "Igor Zlatanovic",
    "shirt": 9
  }
];

/** שם קצר לתצוגה בכרטיס שחקן: שם משפחה בלבד. */
export function shortName(nameHe: string): string {
  const parts = nameHe.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : nameHe;
}

export const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t]));
export const PLAYERS_BY_TEAM = TEAMS.map((t) => ({
  team: t,
  players: PLAYERS.filter((p) => p.teamId === t.id),
}));
