'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { menuData, addonsData, generateSKU, getBaseProductId, type MenuItem } from '@/lib/menu';
import { createBill, type BillItem } from '@/lib/firestore';
import ShawarmaRow from '@/components/ShawarmaRow';
import GrillButtonWithStepper from '@/components/GrillButtonWithStepper';
import SimpleStepperButton from '@/components/SimpleStepperButton';
import ShawarmaAddonsModal from '@/components/ShawarmaAddonsModal';

interface CartItem extends BillItem {
  itemId: string;
  variant: string;
  selectedAddons: string[];
  cartKey: string; // Unique key: itemId-variant-addons
  baseProductId: string;
}

// Brand colors from SVG
const BRAND_RED = '#d43f2f';
const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';

export default function POSPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [addonsModal, setAddonsModal] = useState<{
    item: MenuItem;
    variant: 'Roll' | 'Plate';
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthenticated(true);
      } else {
        router.push('/login');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  // Generate unique cart key - consistent and deterministic
  const generateCartKey = (itemId: string, variant: string, addons: string[]): string => {
    const sortedAddons = [...addons].sort().join(',');
    return `${itemId}-${variant}-${sortedAddons}`;
  };

  // Get quantity for a specific variant type (Roll or Plate) of a base product
  const getVariantQuantity = (itemId: string, variantType: 'Roll' | 'Plate'): number => {
    const baseProductId = getBaseProductId(itemId);
    return cart
      .filter(item => 
        getBaseProductId(item.itemId) === baseProductId && 
        item.variant === variantType
      )
      .reduce((sum, item) => sum + item.qty, 0);
  };

  // Get quantity for specific variant+addons combination
  const getQuantity = (itemId: string, variant: string, addons: string[] = []): number => {
    const cartKey = generateCartKey(itemId, variant, addons);
    const cartItem = cart.find(item => item.cartKey === cartKey);
    return cartItem?.qty || 0;
  };

  // Core cart update function - single source of truth
  const updateCartQuantity = (item: MenuItem, variant: string, quantity: number, addons: string[] = []) => {
    const variantKey = variant || '';
    const basePrice = item.variants[variantKey] || 0;
    
    // Calculate addon prices
    const addonPrices = addons.map(addonId => {
      const addon = addonsData.find(a => a.id === addonId);
      if (!addon) return { name: '', price: 0 };
      const addonPrice = addon.price[variantKey] || addon.price[''] || 0;
      return {
        name: addon.name,
        price: addonPrice
      };
    }).filter(a => a.name); // Remove empty addons

    const addonTotal = addonPrices.reduce((sum, a) => sum + a.price, 0);
    const itemTotal = (basePrice + addonTotal) * quantity;
    const sku = generateSKU(item.id, variant, addons);
    const cartKey = generateCartKey(item.id, variant, addons);
    const baseProductId = getBaseProductId(item.id);

    setCart(prev => {
      // Find existing item by cartKey
      const existingIndex = prev.findIndex(cartItem => cartItem.cartKey === cartKey);
      
      if (quantity > 0) {
        const cartItem: CartItem = {
          sku,
          name: item.name,
          variant: variant || 'Standard',
          qty: quantity,
          basePrice,
          addons: addonPrices,
          itemTotal,
          itemId: item.id,
          selectedAddons: addons,
          cartKey,
          baseProductId
        };
        
        if (existingIndex >= 0) {
          // Update existing item in place to maintain position
          const updated = [...prev];
          updated[existingIndex] = cartItem;
          return updated;
        } else {
          // Add new item at the end
          return [...prev, cartItem];
        }
      } else {
        // Remove item if quantity is 0
        if (existingIndex >= 0) {
          return prev.filter((_, index) => index !== existingIndex);
        }
        return prev;
      }
    });
  };

  // Handle adding item without add-ons
  const handleAddItem = (item: MenuItem, variant: string) => {
    const currentQty = getQuantity(item.id, variant, []);
    updateCartQuantity(item, variant, currentQty + 1, []);
  };

  // Handle adding Shawarma normal (without add-ons)
  const handleAddShawarmaNormal = (item: MenuItem, variant: 'Roll' | 'Plate') => {
    const currentQty = getQuantity(item.id, variant, []);
    updateCartQuantity(item, variant, currentQty + 1, []);
  };

  // Handle decrementing Shawarma variant
  const handleDecrementShawarma = (item: MenuItem, variant: 'Roll' | 'Plate') => {
    const baseProductId = getBaseProductId(item.id);
    // Get all items of this base product with this variant type
    const variantItems = cart.filter(c => 
      getBaseProductId(c.itemId) === baseProductId && 
      c.variant === variant
    );
    
    if (variantItems.length === 0) return;
    
    // Prefer decrementing from base item (no add-ons)
    const baseItem = variantItems.find(c => 
      c.itemId === item.id && 
      c.selectedAddons.length === 0
    );
    
    if (baseItem && baseItem.qty > 0) {
      updateCartQuantity(item, variant, baseItem.qty - 1, []);
      return;
    }
    
    // Otherwise, decrement from first available item of this variant
    const itemToDecrement = variantItems[0];
    const menuItem = menuData.find(m => m.id === itemToDecrement.itemId);
    if (menuItem) {
      updateCartQuantity(menuItem, variant, itemToDecrement.qty - 1, itemToDecrement.selectedAddons);
    }
  };

  // Handle Shawarma add-ons dialog
  const handleShawarmaAddons = (item: MenuItem, variant: 'Roll' | 'Plate') => {
    setAddonsModal({ item, variant });
  };

  // Handle add-ons confirmation - adds items with selected add-ons
  const handleAddonsConfirm = (quantity: number, addons: string[]) => {
    if (!addonsModal) return;
    const { item, variant } = addonsModal;
    const currentQty = getQuantity(item.id, variant, addons);
    updateCartQuantity(item, variant, currentQty + quantity, addons);
    setAddonsModal(null);
  };

  // Remove item from cart
  const removeFromCart = (cartKey: string) => {
    setCart(prev => {
      const existingIndex = prev.findIndex(item => item.cartKey === cartKey);
      if (existingIndex >= 0) {
        return prev.filter((_, index) => index !== existingIndex);
      }
      return prev;
    });
  };

  // Handle quantity change in cart - direct update using cartKey
  const handleCartQuantityChange = (cartKey: string, newQuantity: number) => {
    if (newQuantity < 0) return;
    
    setCart(prev => {
      const existingIndex = prev.findIndex(item => item.cartKey === cartKey);
      if (existingIndex < 0) return prev;
      
      const existingItem = prev[existingIndex];
      
      if (newQuantity === 0) {
        // Remove item
        return prev.filter((_, index) => index !== existingIndex);
      }
      
      // Update quantity in place
      const updated = [...prev];
      const itemTotal = existingItem.basePrice * newQuantity + 
        existingItem.addons.reduce((sum, addon) => sum + addon.price * newQuantity, 0);
      
      updated[existingIndex] = {
        ...existingItem,
        qty: newQuantity,
        itemTotal
      };
      
      return updated;
    });
  };

  const subtotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);
  const grandTotal = subtotal; // Tax already included
  const cgst = grandTotal * 0.025;
  const sgst = grandTotal * 0.025;

  const handleGenerateBill = async () => {
    if (!customerName.trim()) {
      alert('Please enter customer name');
      return;
    }

    if (cart.length === 0) {
      alert('Please add items to cart');
      return;
    }

    setGenerating(true);

    try {
      const billItems: BillItem[] = cart.map(item => ({
        sku: item.sku,
        name: item.name,
        variant: item.variant,
        qty: item.qty,
        basePrice: item.basePrice,
        addons: item.addons,
        itemTotal: item.itemTotal
      }));

      const { billNo, publicToken } = await createBill({
        customer: { 
          name: customerName.trim(),
          ...(customerMobile.trim() && { mobile: customerMobile.trim() })
        },
        items: billItems,
        subtotal,
        cgst,
        sgst,
        grandTotal,
        paymentMode: 'Cash'
      });

      router.push(`/bill/${billNo}?token=${encodeURIComponent(publicToken)}`);
    } catch (error) {
      console.error('Error creating bill:', error);
      alert('Failed to generate bill. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  // Group menu items by category
  const menuByCategory = useMemo(() => {
    const grouped: { [key: string]: MenuItem[] } = {};
    menuData.forEach(item => {
      if (!grouped[item.category]) {
        grouped[item.category] = [];
      }
      grouped[item.category].push(item);
    });
    return grouped;
  }, []);

  // Get aggregated quantity for base product (for Breads & Dips and Grill Chicken)
  const getAggregatedQuantity = (itemId: string): number => {
    const baseProductId = getBaseProductId(itemId);
    return cart
      .filter(item => getBaseProductId(item.itemId) === baseProductId)
      .reduce((sum, item) => sum + item.qty, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-xl" style={{ color: SOFT_BLACK }}>Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b" style={{ borderColor: SOFT_GRAY }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold" style={{ color: SOFT_BLACK }}>DAJAJ POS</h1>
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/bills')}
              className="px-4 py-2 rounded-md transition-colors"
              style={{ backgroundColor: SOFT_GRAY, color: SOFT_BLACK, border: `1px solid ${SOFT_GRAY}` }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e0e0e0'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_GRAY}
            >
              Bill History
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-md transition-colors"
              style={{ backgroundColor: SOFT_BLACK, color: SOFT_WHITE }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Menu */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6" style={{ color: SOFT_BLACK }}>Menu</h2>
            <div className="space-y-8">
              {/* Shawarmas */}
              {menuByCategory['Shawarmas'] && (
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ color: SOFT_BLACK }}>Shawarmas</h3>
                  <div className="space-y-4">
                    {menuByCategory['Shawarmas'].map(item => {
                      const rollPrice = item.variants['Roll'] || 0;
                      const platePrice = item.variants['Plate'] || 0;
                      const rollQuantity = getVariantQuantity(item.id, 'Roll');
                      const plateQuantity = getVariantQuantity(item.id, 'Plate');
                      
                      return (
                        <ShawarmaRow
                          key={item.id}
                          item={item}
                          rollQuantity={rollQuantity}
                          plateQuantity={plateQuantity}
                          rollPrice={rollPrice}
                          platePrice={platePrice}
                          onAddNormal={(variant) => handleAddShawarmaNormal(item, variant)}
                          onDecrement={(variant) => handleDecrementShawarma(item, variant)}
                          onOpenAddonsDialog={(variant) => handleShawarmaAddons(item, variant)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Grill Chicken */}
              {menuByCategory['Grill Chicken'] && (
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ color: SOFT_BLACK }}>Grill Chicken</h3>
                  <div className="space-y-4">
                    {menuByCategory['Grill Chicken'].map(item => (
                      <div key={item.id} className="mb-4">
                        <h4 className="font-semibold mb-2" style={{ color: SOFT_BLACK }}>{item.name}</h4>
                        <div className="grid grid-cols-3 gap-2">
                          {Object.entries(item.variants).map(([variant, price]) => (
                            <GrillButtonWithStepper
                              key={variant}
                              variant={variant}
                              price={price}
                              quantity={getQuantity(item.id, variant, [])}
                              onIncrement={() => handleAddItem(item, variant)}
                              onDecrement={() => {
                                const currentQty = getQuantity(item.id, variant, []);
                                if (currentQty > 0) {
                                  updateCartQuantity(item, variant, currentQty - 1, []);
                                }
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Breads & Dips */}
              {menuByCategory['Breads & Dips'] && (
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ color: SOFT_BLACK }}>Breads & Dips</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {menuByCategory['Breads & Dips'].map(item => {
                      const variant = Object.keys(item.variants)[0] || '';
                      const price = item.variants[variant] || 0;
                      const aggregatedQty = getAggregatedQuantity(item.id);
                      return (
                        <SimpleStepperButton
                          key={item.id}
                          name={item.name}
                          price={price}
                          quantity={aggregatedQty}
                          onIncrement={() => handleAddItem(item, variant)}
                          onDecrement={() => {
                            const currentQty = getQuantity(item.id, variant, []);
                            if (currentQty > 0) {
                              updateCartQuantity(item, variant, currentQty - 1, []);
                            }
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Cart & Bill */}
        <div className="lg:col-span-1">
          <div className="bg-white border rounded-lg p-6 space-y-4 sticky top-4" style={{ borderColor: SOFT_GRAY }}>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: SOFT_BLACK }}>
                Customer Name *
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter customer name"
                className="w-full px-3 py-3 rounded-md focus:outline-none focus:ring-2 transition-colors"
                style={{ 
                  borderColor: SOFT_GRAY,
                  color: SOFT_BLACK,
                  borderWidth: '1px'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = BRAND_RED;
                  e.currentTarget.style.boxShadow = `0 0 0 2px ${BRAND_RED}20`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = SOFT_GRAY;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: SOFT_BLACK }}>
                Customer Mobile
              </label>
              <input
                type="tel"
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value)}
                placeholder="9XXXXXXXXX (Optional)"
                className="w-full px-3 py-3 rounded-md focus:outline-none focus:ring-2 transition-colors"
                style={{ 
                  borderColor: SOFT_GRAY,
                  color: SOFT_BLACK,
                  borderWidth: '1px'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = BRAND_RED;
                  e.currentTarget.style.boxShadow = `0 0 0 2px ${BRAND_RED}20`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = SOFT_GRAY;
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: SOFT_BLACK }}>Items</h3>
              <div className="space-y-2">
                {cart.length === 0 ? (
                  <p className="text-sm" style={{ color: SOFT_BLACK + '99' }}>No items added</p>
                ) : (
                  cart.map((item) => (
                    <div key={item.cartKey} className="p-3 rounded-lg border" style={{ backgroundColor: SOFT_WHITE, borderColor: SOFT_GRAY }}>
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm" style={{ color: SOFT_BLACK }}>{item.name}</div>
                          <div className="text-xs" style={{ color: SOFT_BLACK + '99' }}>{item.variant}</div>
                          {item.addons.length > 0 && (
                            <div className="text-xs mt-1" style={{ color: SOFT_BLACK + '80' }}>
                              + {item.addons.map(a => a.name).join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="font-medium text-sm" style={{ color: SOFT_BLACK }}>₹{item.itemTotal.toFixed(2)}</div>
                          
                          {/* Quantity Control */}
                          <div className="flex items-center gap-2 rounded-lg border bg-white overflow-hidden" style={{ borderColor: SOFT_GRAY }}>
                            <button
                              onClick={() => handleCartQuantityChange(item.cartKey, item.qty - 1)}
                              className="flex items-center justify-center transition-colors font-bold text-lg"
                              style={{
                                minHeight: '36px',
                                minWidth: '36px',
                                color: SOFT_BLACK
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              –
                            </button>
                            <div className="flex items-center justify-center font-semibold text-sm min-w-[32px]" style={{ color: SOFT_BLACK }}>
                              {item.qty}
                            </div>
                            <button
                              onClick={() => handleCartQuantityChange(item.cartKey, item.qty + 1)}
                              className="flex items-center justify-center transition-colors font-bold text-lg"
                              style={{
                                minHeight: '36px',
                                minWidth: '36px',
                                color: SOFT_BLACK
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              +
                            </button>
                          </div>
                          
                          {/* Remove Button - Highlighted */}
                          <button
                            onClick={() => removeFromCart(item.cartKey)}
                            className="text-xs px-2 py-1 rounded transition-colors font-medium"
                            style={{ 
                              color: BRAND_RED,
                              border: `1px solid ${BRAND_RED}`,
                              backgroundColor: 'transparent'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = BRAND_RED;
                              e.currentTarget.style.color = SOFT_WHITE;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'transparent';
                              e.currentTarget.style.color = BRAND_RED;
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t pt-4 space-y-2" style={{ borderColor: SOFT_GRAY }}>
              <div className="flex justify-between text-sm" style={{ color: SOFT_BLACK }}>
                <span>Subtotal:</span>
                <span>₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm" style={{ color: SOFT_BLACK + '99' }}>
                <span>CGST (2.5%):</span>
                <span>₹{cgst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm" style={{ color: SOFT_BLACK + '99' }}>
                <span>SGST (2.5%):</span>
                <span>₹{sgst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t pt-2" style={{ color: SOFT_BLACK, borderColor: SOFT_GRAY }}>
                <span>Grand Total:</span>
                <span>₹{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={handleGenerateBill}
              disabled={generating || cart.length === 0 || !customerName.trim()}
              className="w-full py-4 px-4 rounded-md font-medium transition-colors"
              style={{ 
                backgroundColor: cart.length === 0 || !customerName.trim() ? SOFT_GRAY : SOFT_BLACK,
                color: SOFT_WHITE
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = '#2a2a2a';
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = SOFT_BLACK;
                }
              }}
            >
              {generating ? 'Generating...' : 'Generate Bill'}
            </button>
          </div>
        </div>
      </div>

      {/* Shawarma Add-ons Modal */}
      {addonsModal && (
        <ShawarmaAddonsModal
          itemName={addonsModal.item.name}
          variant={addonsModal.variant}
          variantPrice={addonsModal.item.variants[addonsModal.variant]}
          onClose={() => setAddonsModal(null)}
          onConfirm={handleAddonsConfirm}
        />
      )}
    </div>
  );
}
