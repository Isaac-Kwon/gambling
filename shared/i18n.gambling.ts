import ko from '@i18n/gambling.ko.json';
import en from '@i18n/gambling.en.json';
import it from '@i18n/gambling.it.json';
import { makeT, type Dictionaries } from './i18n';

// Per-page modules keep each page's bundle free of the other page's strings.
export const dictionaries: Dictionaries = { ko, en, it };
export const t = makeT(dictionaries);
