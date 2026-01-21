'use client';

import { useState } from 'react';
import { menuData, addonsData, type MenuItem } from '@/lib/menu';

type VariantKey = 'Roll' | 'Plate' | '';

interface ItemModalProps {
  item: MenuItem;
  onClose: () => void;
  onAdd: (variant: string, quantity: number, addons: string[]) => void;
}

export default function ItemModal({ item, onClose, onAdd }: ItemModalProps) {
  const [selectedVariant, setSelectedVariant] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);

  const variants = Object.keys(item.variants) as VariantKey[];
  const applicableAddons = addonsData.filter(addon => {
    // Check if addon has prices for any variant of this item
    const itemVariants = Object.keys(item.variants) as VariantKey[];
    return itemVariants.some(v => addon.price[v] !== undefined) || 
           addon.price[''] !== undefined;
  });

  const handleVariantChange = (variant: string) => {
    setSelectedVariant(variant);
    // Reset addons that don't apply to this variant
    setSelectedAddons(prev => prev.filter(addonId => {
      const addon = addonsData.find(a => a.id === addonId);
      if (!addon) return false;
      return addon.price[variant as VariantKey] !== undefined || addon.price[''] !== undefined;
    }));
  };

  const toggleAddon = (addonId: string) => {
    setSelectedAddons(prev => 
      prev.includes(addonId) 
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  const getAddonPrice = (addonId: string): number => {
    const addon = addonsData.find(a => a.id === addonId);
    if (!addon) return 0;
    return addon.price[selectedVariant as VariantKey] ?? addon.price[''] ?? 0;
  };

  const basePrice = selectedVariant ? item.variants[selectedVariant] ?? 0 : 0;
  const addonTotal = selectedAddons.reduce((sum, id) => sum + getAddonPrice(id), 0);
  const total = (basePrice + addonTotal) * quantity;

  const handleConfirm = () => {
    if (!selectedVariant && variants.length > 0) {
      alert('Please select a variant');
      return;
    }
    onAdd(selectedVariant, quantity, selectedAddons);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{item.name}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {variants.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Variant
            </label>
            <div className="space-y-2">
              {variants.map(variant => (
                <label key={variant} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="variant"
                    value={variant}
                    checked={selectedVariant === variant}
                    onChange={() => handleVariantChange(variant)}
                    className="text-blue-600"
                  />
                  <span className="text-sm">
                    {variant || 'Standard'}: ₹{item.variants[variant] ?? 0}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {variants.length === 0 && (
          <div className="mb-4">
            <div className="text-sm font-medium text-gray-700">
              Price: ₹{item.variants['']}
            </div>
          </div>
        )}

        {applicableAddons.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Add-ons
            </label>
            <div className="space-y-2">
              {applicableAddons.map(addon => {
                const price = getAddonPrice(addon.id);
                const isSelected = selectedAddons.includes(addon.id);
                const canSelect = selectedVariant 
                  ? (addon.price[selectedVariant as VariantKey] !== undefined || addon.price[''] !== undefined)
                  : addon.price[''] !== undefined;

                if (!canSelect) return null;

                return (
                  <label key={addon.id} className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleAddon(addon.id)}
                        className="text-blue-600"
                      />
                      <span className="text-sm">{addon.name}</span>
                    </div>
                    <span className="text-sm text-gray-600">₹{price}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Quantity
          </label>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-8 h-8 bg-gray-200 rounded-md hover:bg-gray-300"
            >
              -
            </button>
            <span className="text-lg font-medium">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-8 h-8 bg-gray-200 rounded-md hover:bg-gray-300"
            >
              +
            </button>
          </div>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <div className="flex justify-between text-lg font-semibold">
            <span>Total:</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={variants.length > 0 && !selectedVariant}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}

