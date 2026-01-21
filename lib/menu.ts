export interface MenuItem {
  id: string;
  name: string;
  category: string;
  variants: {
    [key: string]: number;
  };
  addons?: {
    name: string;
    price: {
      [key: string]: number;
    };
  }[];
}

export const menuData: MenuItem[] = [
  // Shawarmas
  {
    id: 'shw-reg',
    name: 'Regular Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 50, Plate: 100 }
  },
  {
    id: 'shw-peri',
    name: 'Peri Peri Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 60, Plate: 110 }
  },
  {
    id: 'shw-tandoori',
    name: 'Tandoori Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 60, Plate: 110 }
  },
  {
    id: 'shw-wm',
    name: 'Whole Meat Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 80, Plate: 140 }
  },
  {
    id: 'shw-wm-peri',
    name: 'Whole Meat Peri Peri Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 90, Plate: 150 }
  },
  {
    id: 'shw-wm-tandoori',
    name: 'Whole Meat Tandoori Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 90, Plate: 150 }
  },
  {
    id: 'shw-jumbo',
    name: 'Jumbo Shawarma',
    category: 'Shawarmas',
    variants: { Roll: 130 }
  },
  // Grill Chicken
  {
    id: 'grill-chicken',
    name: 'Grill Chicken',
    category: 'Grill Chicken',
    variants: { Qtr: 120, Half: 210, Full: 399 }
  },
  {
    id: 'grill-spcl',
    name: 'Spcl Grilled Dajaj',
    category: 'Grill Chicken',
    variants: { Qtr: 140, Half: 250, Full: 449 }
  },
  // Breads & Dips
  {
    id: 'khubbus',
    name: 'Khubbus',
    category: 'Breads & Dips',
    variants: { '': 10 }
  },
  {
    id: 'rumali',
    name: 'Rumali Roti',
    category: 'Breads & Dips',
    variants: { '': 15 }
  },
  {
    id: 'garlic-mayo',
    name: 'Garlic Mayo',
    category: 'Breads & Dips',
    variants: { '': 20 }
  },
  {
    id: 'peri-mayo',
    name: 'Peri Peri Mayo',
    category: 'Breads & Dips',
    variants: { '': 20 }
  },
  {
    id: 'tandoori-mayo',
    name: 'Tandoori Mayo',
    category: 'Breads & Dips',
    variants: { '': 20 }
  }
];

export const addonsData = [
  {
    id: 'extra-spicy',
    name: 'Extra Spicy',
    price: { '': 5 }
  },
  {
    id: 'fries',
    name: 'French Fries',
    price: { Roll: 10, Plate: 15 }
  },
  {
    id: 'cheese',
    name: 'Cheese',
    price: { Roll: 20, Plate: 30 }
  }
];

/**
 * Get base product ID for aggregated quantity calculation
 * All variants of the same base product share the same baseProductId
 */
export function getBaseProductId(itemId: string): string {
  if (itemId.startsWith('shw-')) {
    return itemId; // Each shawarma type is its own base product
  } else if (itemId.startsWith('grill-')) {
    return itemId; // Each grill type is its own base product
  } else {
    return itemId; // Other items are their own base
  }
}

export function generateSKU(itemId: string, variant: string, addons: string[] = []): string {
  const parts: string[] = [];
  
  // Item prefix
  if (itemId.startsWith('shw-')) {
    parts.push('SHW');
    if (itemId.includes('reg')) parts.push('REG');
    else if (itemId.includes('peri')) parts.push('PERI');
    else if (itemId.includes('tandoori')) parts.push('TANDOORI');
    else if (itemId.includes('wm')) parts.push('WM');
    if (itemId.includes('jumbo')) parts.push('JUMBO');
  } else if (itemId.startsWith('grill-')) {
    parts.push('GRILL');
    if (itemId.includes('spcl')) parts.push('SPCL');
    else parts.push('CHICKEN');
  } else if (itemId.includes('khubbus')) {
    parts.push('BREAD-KHUBBUS');
  } else if (itemId.includes('rumali')) {
    parts.push('BREAD-RUMALI');
  } else if (itemId.includes('garlic-mayo')) {
    parts.push('DIP-GARLIC');
  } else if (itemId.includes('peri-mayo')) {
    parts.push('DIP-PERI');
  } else if (itemId.includes('tandoori-mayo')) {
    parts.push('DIP-TANDOORI');
  }
  
  // Variant
  if (variant && variant !== '') {
    parts.push(variant.toUpperCase());
  }
  
  // Addons
  addons.forEach(addon => {
    if (addon === 'extra-spicy') parts.push('SPICY');
    else if (addon === 'fries') parts.push('FRIES');
    else if (addon === 'cheese') parts.push('CHEESE');
  });
  
  return parts.join('-');
}
