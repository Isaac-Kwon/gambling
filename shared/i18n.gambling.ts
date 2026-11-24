import { makeT, mergeDictionaries, type Dict } from './i18n';

// Separate glob per page keeps each page's bundle free of the other page's strings.
export const files = import.meta.glob<Dict>('../i18n/gambling/*.json', { eager: true, import: 'default' });
export const dictionaries = mergeDictionaries(files);
export const t = makeT(dictionaries);
