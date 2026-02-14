export type MenuPriceRow = {
  item: string;
  prices: number[];
};

export type MenuSinglePriceRow = {
  item: string;
  price: number;
};

export const displayMenu = {
  brand: {
    name: "DAJAJ",
    tagline: "The Spice of Spices",
    cateringContact: "+91 7019044480",
  },
  alfaham: {
    headers: ["Qtr", "Half", "Full"],
    rows: [
      { item: "Regular", prices: [120, 230, 400] },
      { item: "Lemon", prices: [130, 250, 430] },
      { item: "Pepper", prices: [140, 260, 450] },
      { item: "Special", prices: [150, 280, 480] },
    ] satisfies MenuPriceRow[],
  },
  charcoal: [
    { item: "Tikka (per Piece)", price: 70 },
    { item: "Lollipop", price: 200 },
  ] satisfies MenuSinglePriceRow[],
  grill: {
    headers: ["Qtr", "Half", "Full"],
    rows: [{ item: "Grill Chicken", prices: [120, 230, 399] }] satisfies MenuPriceRow[],
  },
  khubbusShawarma: {
    headers: ["Roll", "Plate"],
    rows: [
      { item: "Regular", prices: [50, 100] },
      { item: "Peri Peri", prices: [60, 110] },
      { item: "Tandoori", prices: [60, 110] },
      { item: "Whole Meat", prices: [80, 140] },
      { item: "Whole Meat Peri Peri", prices: [90, 150] },
      { item: "Whole Meat Tandoori", prices: [90, 150] },
    ] satisfies MenuPriceRow[],
    note: "Add on cheese @ 20/30",
  },
  rumaliShawarma: {
    headers: ["Roll", "Plate"],
    rows: [
      { item: "Regular", prices: [80, 130] },
      { item: "Peri Peri", prices: [90, 140] },
      { item: "Tandoori", prices: [90, 140] },
      { item: "Whole Meat", prices: [110, 170] },
      { item: "Whole Meat Peri Peri", prices: [120, 180] },
      { item: "Whole Meat Tandoori", prices: [120, 180] },
    ] satisfies MenuPriceRow[],
  },
  specialItem: "BYOB Chips Shawarma @ 99",
  tandoorSpecial: {
    headers: ["Qtr", "Half", "Full"],
    rows: [{ item: "Tandoori Chicken", prices: [130, 250, 480] }] satisfies MenuPriceRow[],
  },
  tandooriKebab: [
    { item: "Tikka", price: 260 },
    { item: "Angara", price: 280 },
    { item: "Malai", price: 300 },
  ] satisfies MenuSinglePriceRow[],
  tandooriParathas: [
    { item: "Egg Paratha", price: 60 },
    { item: "Chicken Paratha", price: 80 },
  ] satisfies MenuSinglePriceRow[],
  tandoorBreads: {
    headers: ["Plain", "Butter", "Garlic"],
    rows: [
      { item: "Roti", prices: [15, 20, 25] },
      { item: "Naan", prices: [30, 40, 50] },
      { item: "Kulcha", prices: [35, 45, 55] },
    ] satisfies MenuPriceRow[],
  },
  breadsAndDips: [
    { item: "Khubbus", price: 10 },
    { item: "Rumali Roti", price: 20 },
    { item: "Garlic Mayo", price: 20 },
    { item: "Peri Peri Mayo", price: 20 },
    { item: "Tandoori Mayo", price: 20 },
  ] satisfies MenuSinglePriceRow[],
} as const;
