import { ref } from 'vue';

const STORAGE_KEY = 'manzili_lang';
const lang = ref(typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) || 'en') : 'en');

export const translations = {
  en: {
    controlPanel: 'Control Panel',
    units: 'Units',
    tenants: 'Tenants',
    send: 'Send',
    archive: 'Archive',
    logs: 'Logs',
    allProperties: 'All properties',
    panel: 'Panel',
    refresh: 'Refresh',
    pullingResources: 'Pulling resources',
    showing: 'Showing',
    backToToday: 'Back to today',
    netIncome: 'Net income',
    rentCollected: 'Rent collected',
    maintenanceSpend: 'Maintenance spend',
    update: 'Update',
    pending: 'Pending',
    overdue: 'Overdue',
    occupancy: 'Occupancy',
    deposits: 'Deposits',
    paidUp: 'Paid up',
    incomeLast6Months: 'Income, last 6 months',
    payments: 'Payments',
    live: 'Live',
    offline: 'Offline',
    history: 'History',
    housesByType: 'Houses by type',
    addHouse: 'Add house',
    prices: 'Prices',
    overdueRent: 'Overdue rent by age',
    signOut: 'Sign out',
    addProperty: 'Add property',
    refreshUpdated: 'Control Panel is up to date.',
    property: 'Property',
    all: 'All',
    houses: 'Houses',
    pleaseEnter: 'Please enter',
    filter: 'Filter',
    english: 'English',
    swahili: 'Swahili',
  },
  sw: {
    controlPanel: 'Ubao wa Udhibiti',
    units: 'Vitengo',
    tenants: 'Wakodishaji',
    send: 'Tuma',
    archive: 'Hifadhi',
    logs: 'Kumbukumbu',
    allProperties: 'Mali zote',
    panel: 'Ubao',
    refresh: 'Sasisha',
    pullingResources: 'Inapakia rasilimali',
    showing: 'Inaonyesha',
    backToToday: 'Rudi leo',
    netIncome: 'Mapato halisi',
    rentCollected: 'Kodi iliyokusanywa',
    maintenanceSpend: 'Gharama za matengenezo',
    update: 'Sasisha',
    pending: 'Inasubiri',
    overdue: 'Imechelewesha',
    occupancy: 'Utumiaji',
    deposits: 'Amana',
    paidUp: 'Imelipwa',
    incomeLast6Months: 'Mapato, miezi 6 iliyopita',
    payments: 'Malipo',
    live: 'Moja kwa moja',
    offline: 'Imezima',
    history: 'Historia',
    housesByType: 'Nyumba kwa aina',
    addHouse: 'Ongeza nyumba',
    prices: 'Bei',
    overdueRent: 'Kodi iliyocheleweshwa kwa umri',
    signOut: 'Toka',
    addProperty: 'Ongeza mali',
    refreshUpdated: 'Ubao wa Udhibiti umeboreshwa.',
    property: 'Mali',
    all: 'Zote',
    houses: 'Nyumba',
    pleaseEnter: 'Tafadhali ingiza',
    filter: 'Chuja',
    english: 'Kiingereza',
    swahili: 'Kiswahili',
  },
};

export function getLanguage() {
  return lang.value;
}

export function setLanguage(value) {
  const next = ['en', 'sw'].includes(value) ? value : 'en';
  lang.value = next;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  return next;
}

export function useLanguage() {
  return lang;
}

export function t(key, locale = lang.value) {
  return translations[locale]?.[key] ?? translations.en[key] ?? key;
}
