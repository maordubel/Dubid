/**
 * data/teamColors.ts — זהות צבע לכל קבוצה, לרינדור חולצה גנרית.
 *
 * לא לוגו, לא ערכת משחק רשמית — רק צבע ראשי + צבע מסגרת, בהשראת
 * הצבעים המוכרים של כל מועדון. נשמר נפרד מ-squads.ts כדי לא לגעת
 * בצינור היצירה (`build-squads.mjs`) בשביל שדה עיצובי בלבד.
 */
export interface TeamColor {
  primary: string;
  trim: string;
}

export const TEAM_COLORS: Record<string, TeamColor> = {
  T1: { primary: '#D0102B', trim: '#111111' },   // הפועל באר שבע
  T2: { primary: '#E4032E', trim: '#FFD100' },   // הפועל ירושלים
  T3: { primary: '#FFDD00', trim: '#0B3D91' },   // מכבי תל אביב
  T4: { primary: '#0B6E4F', trim: '#D71920' },   // מכבי חיפה
  T5: { primary: '#FFD100', trim: '#111111' },   // בית"ר ירושלים
  T6: { primary: '#E4032E', trim: '#FFFFFF' },   // הפועל תל אביב
  T7: { primary: '#F5C518', trim: '#0B3D91' },   // מכבי נתניה
  T8: { primary: '#D0103A', trim: '#FFFFFF' },   // בני סכנין
  T9: { primary: '#C8102E', trim: '#0EA5A5' },   // הפועל חיפה
  T10: { primary: '#FFCD00', trim: '#0B3D91' },  // עירוני קרית שמונה
  T11: { primary: '#1C4E9C', trim: '#FFFFFF' },  // עירוני טבריה
  T12: { primary: '#1F8A46', trim: '#FFFFFF' },  // מכבי פתח תקווה
  T13: { primary: '#B3122A', trim: '#FFFFFF' },  // הפועל רמת גן
  T14: { primary: '#D1121B', trim: '#111111' },  // הפועל פתח תקווה
};

export const DEFAULT_TEAM_COLOR: TeamColor = { primary: '#3A3F4B', trim: '#C9CDD6' };

export function teamColor(teamId: string): TeamColor {
  return TEAM_COLORS[teamId] ?? DEFAULT_TEAM_COLOR;
}
