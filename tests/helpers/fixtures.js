// Small, recognisable data for the tests.

const verse = (label, text) => ({ label, text });

// Verse / chorus / verse / verse — the chorus is sung after every verse.
const amazingGrace = {
    id: 1, song_number: 12, title: 'Amazing Grace', author: 'John Newton', musical_key: 'G',
    verses: [
        verse('Verse 1', 'Amazing grace, how sweet the sound'),
        verse('Chorus', 'My chains are gone, I have been set free'),
        verse('Verse 2', 'Twas grace that taught my heart to fear'),
        verse('Verse 3', 'Through many dangers, toils and snares'),
    ],
};

// No chorus: plain top-to-bottom order.
const holyHolyHoly = {
    id: 2, song_number: 3, title: 'Holy, Holy, Holy', author: 'Reginald Heber', musical_key: null,
    verses: [
        verse('Verse 1', 'Holy, holy, holy, Lord God Almighty'),
        verse('Verse 2', 'Holy, holy, holy, all the saints adore Thee'),
        verse('Verse 3', 'Holy, holy, holy, though the darkness hide Thee'),
    ],
};

const blessedAssurance = {
    id: 3, song_number: 40, title: 'Blessed Assurance', author: 'Fanny Crosby', musical_key: 'D',
    verses: [
        verse('Verse 1', 'Blessed assurance, Jesus is mine'),
        verse('Chorus', 'This is my story, this is my song'),
    ],
};

const songs = [amazingGrace, holyHolyHoly, blessedAssurance];

// Book codes follow the backend's scheme: canonical number + O/N testament.
const bible = {
    books: [
        { code: '01O', name: 'Genesis', chapters: 50 },
        { code: '19O', name: 'Psalms', chapters: 150 },
        { code: '21O', name: 'Ecclesiastes', chapters: 12 },
        { code: '43N', name: 'John', chapters: 21 },
        { code: '62N', name: '1 John', chapters: 5 },
    ],
    chapters: {
        '43N/3': Array.from({ length: 36 }, (_, i) => ({
            verse: i + 1,
            text: i === 15 ? 'For God so loved the world' : `John three verse ${i + 1}`,
        })),
        // Square brackets mark words the translators supplied; shown in italics.
        '19O/23': [
            { verse: 1, text: 'The LORD [is] my shepherd; I shall not want.' },
            { verse: 2, text: 'He maketh me to lie down in green pastures' },
        ],
    },
    // Keyword search hits, as GET /bible/search returns them.
    search: [
        { book: '19O', chapter: 23, verse: 1, reference: 'Psalms 23:1', text: 'The LORD [is] my shepherd; I shall not want.' },
        { book: '43N', chapter: 3, verse: 16, reference: 'John 3:16', text: 'For God so loved the world' },
    ],
};

// An order of service: song, reading, holding slide, song.
const sundayService = {
    id: 7, name: 'Sunday Morning',
    songs: [
        { id: 101, item_type: 'song', song_id: 2, title: 'Holy, Holy, Holy', author: 'Reginald Heber' },
        { id: 102, item_type: 'bible', reference: 'John 3:16', title: 'John 3:16' },
        { id: 103, item_type: 'logo', title: 'Logo' },
        { id: 104, item_type: 'song', song_id: 1, title: 'Amazing Grace', author: 'John Newton' },
    ],
};

// An installed message library, as the message routes return it. Every
// title, place and paragraph is made up. Codes are date codes (YY-MMDD and a
// letter for the time of day; 00 for a day not known); the book's chapters use
// a prefix of their own, as a real library's do.
const messageWorks = [
    { code: 'BOL-00', kind: 'book', collection: 'Book Of Lamps', title: 'Introduction', chapter: 0, location: null, year: null, sort: 0 },
    { code: 'BOL-01', kind: 'book', collection: 'Book Of Lamps', title: 'The First Lamp', chapter: 1, location: null, year: null, sort: 1 },
    { code: 'BOL-02', kind: 'book', collection: 'Book Of Lamps', title: 'The Second Lamp', chapter: 2, location: null, year: null, sort: 2 },
    { code: '58-0105M', kind: 'message', collection: null, title: 'Seeds In Winter', chapter: null, location: 'Riverton OH', year: 1958, sort: 10 },
    { code: '58-0105E', kind: 'message', collection: null, title: 'The Narrow Bridge', chapter: null, location: 'Riverton OH', year: 1958, sort: 11 },
    { code: '59-0300', kind: 'message', collection: null, title: 'Market Day', chapter: null, location: 'Lakeside MN', year: 1959, sort: 12 },
    { code: '59-0315', kind: 'message', collection: null, title: 'Seeds In Winter', chapter: null, location: 'Lakeside MN', year: 1959, sort: 13 },
    { code: '60-0229', kind: 'message', collection: null, title: 'The Quiet Harbour', chapter: null, location: 'Hillcrest TX', year: 1960, sort: 14 },
    { code: '61-1231', kind: 'message', collection: null, title: 'Lamps And Lanterns', chapter: null, location: 'Hillcrest TX', year: 1961, sort: 15 },
];
const paragraph = (id, number, text) => ({ id, number, text });
const messageLibrary = {
    status: {
        installed: true, tab_label: 'The Test Tab', book_collection: 'Book Of Lamps',
        book_title: 'An Account Of The Lamps', language: 'en', built_at: '2026-11-20T10:00:00Z',
        numbering_id: 'test', message_count: 6, book_chapter_count: 3, paragraph_count: 12,
    },
    works: messageWorks,
    paragraphs: {
        'BOL-01': [paragraph(20, 1, 'The first lamp was lit in a dark room.')],
        '58-0105M': [
            paragraph(1, 1, 'Now the seed lies under the snow all winter long.'),
            paragraph(2, 2, 'And the farmer waits, for the spring will surely come.'),
            paragraph(3, 3, 'Let us bow our heads.'),
        ],
        '58-0105E': [
            paragraph(4, 1, 'The bridge was narrow and the river ran fast below it.'),
            paragraph(5, 2, 'Only one could cross at a time.'),
        ],
        '59-0300': [paragraph(6, 1, 'On market day the whole town came down to the square.')],
        '59-0315': [
            paragraph(7, 1, 'The seed lies under the snow, but it is not dead.'),
            // Brackets are the text's own (a note of what the listeners did), and stay as they are.
            paragraph(8, 2, 'The spring will surely come. [The listeners say amen.]'),
        ],
        '60-0229': [paragraph(9, 1, 'A quiet harbour <is> no place to stay & rest for ever.')],
        '61-1231': [paragraph(10, 1, 'Trim the lamps and light the lanterns.')],
    },
};

module.exports = { songs, amazingGrace, holyHolyHoly, blessedAssurance, bible, sundayService, messageWorks, messageLibrary };
