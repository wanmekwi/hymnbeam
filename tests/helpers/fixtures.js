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
    },
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

module.exports = { songs, amazingGrace, holyHolyHoly, blessedAssurance, bible, sundayService };
