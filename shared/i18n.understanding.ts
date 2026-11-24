import ko from '@i18n/understanding.ko.json';
import en from '@i18n/understanding.en.json';
import it from '@i18n/understanding.it.json';
import { makeT, type Dictionaries } from './i18n';

export const dictionaries: Dictionaries = { ko, en, it };
export const t = makeT(dictionaries);
