// Well-known real estate quotes, shown at random on the sign-in page.
export const QUOTES = [
  { text: 'The best investment on earth is earth.', by: 'Louis Glickman' },
  { text: 'Landlords grow rich in their sleep without working, risking, or economizing.', by: 'John Stuart Mill' },
  { text: 'Property has its duties as well as its rights.', by: 'Thomas Drummond' },
  { text: 'Buying real estate is not only the best way, the quickest way, the safest way, but the only way to become wealthy.', by: 'Marshall Field' },
  { text: 'Owning a home is a keystone of wealth, both financial affluence and emotional security.', by: 'Suze Orman' },
  { text: "Don't wait to buy real estate. Buy real estate and wait.", by: 'Will Rogers' },
];

export const randomQuote = () => QUOTES[Math.floor(Math.random() * QUOTES.length)];
