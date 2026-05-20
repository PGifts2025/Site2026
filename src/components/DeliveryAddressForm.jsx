import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, Loader, Check, AlertCircle } from 'lucide-react';
import { buildAccountSnapshot, accountHasAddress } from '../lib/deliveryValidation';

/**
 * DeliveryAddressForm — B2B delivery capture/edit (PR B).
 *
 * shipping_address jsonb shape:
 *   { company, fao, line1, line2, city, county, postcode, country, phone, instructions }
 * po_number is a sibling text column, edited alongside but stored separately.
 *
 * Two modes:
 *   - Quotes (showAccountToggle=true): a "Deliver to a different address"
 *     toggle (default OFF). OFF shows the account address as a read-only
 *     preview; the parent snapshots it onto the quote at Pay Now time. ON
 *     shows the 11 fields and a Save button.
 *   - Order edit (showAccountToggle=false): always the field form, used to
 *     edit an existing order's delivery address.
 *
 * Hard-required (browser `required`, blocks form submit): line1, city,
 * postcode, country. Soft-required (red asterisk only, required before admin
 * approval — see deliveryValidation.js): fao, phone.
 */

const EMPTY_FIELDS = {
  company: '',
  fao: '',
  line1: '',
  line2: '',
  city: '',
  county: '',
  postcode: '',
  country: 'United Kingdom',
  phone: '',
  instructions: '',
  poNumber: '',
};

const COUNTRIES = ['United Kingdom', 'Ireland', 'United States', 'Canada', 'Australia'];

const fieldsToAddress = (f) => ({
  company: f.company.trim(),
  fao: f.fao.trim(),
  line1: f.line1.trim(),
  line2: f.line2.trim(),
  city: f.city.trim(),
  county: f.county.trim(),
  postcode: f.postcode.trim(),
  country: f.country.trim(),
  phone: f.phone.trim(),
  instructions: f.instructions.trim(),
});

const addressToFields = (addr, poNumber) => ({
  company: addr?.company || '',
  fao: addr?.fao || '',
  line1: addr?.line1 || '',
  line2: addr?.line2 || '',
  city: addr?.city || '',
  county: addr?.county || '',
  postcode: addr?.postcode || '',
  country: addr?.country || 'United Kingdom',
  phone: addr?.phone || '',
  instructions: addr?.instructions || '',
  poNumber: poNumber || '',
});

const DeliveryAddressForm = ({
  entity,
  accountProfile = null,
  showAccountToggle = true,
  onSave,
  onStatusChange,
  saveLabel = 'Save delivery details',
}) => {
  const hasAccountAddr = accountHasAddress(accountProfile);
  const entityAddr = entity?.shipping_address || null;

  // mode: 'account' (use saved account address) | 'custom' (enter fields)
  const initialMode = useMemo(() => {
    if (entityAddr) return 'custom'; // already has a saved address → edit it
    if (showAccountToggle && hasAccountAddr) return 'account';
    return 'custom';
  }, [entityAddr, showAccountToggle, hasAccountAddr]);

  const [mode, setMode] = useState(initialMode);
  const [fields, setFields] = useState(() =>
    entityAddr ? addressToFields(entityAddr, entity?.po_number) : { ...EMPTY_FIELDS },
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState(null);

  // Report status up so the parent (Pay Now) knows whether it can proceed.
  useEffect(() => {
    if (typeof onStatusChange === 'function') {
      onStatusChange({ mode, dirty, hasAccountAddress: hasAccountAddr });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dirty, hasAccountAddr]);

  const setField = (key, value) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSavedFlash(false);
    if (error) setError(null);
  };

  const switchToCustom = () => {
    // Seed custom fields from the account snapshot so the customer has a
    // starting point rather than a blank form.
    if (mode !== 'custom') {
      const snap = buildAccountSnapshot(accountProfile);
      setFields((prev) => ({ ...prev, ...snap, poNumber: prev.poNumber }));
      setMode('custom');
      setDirty(true);
    }
  };

  const switchToAccount = () => {
    setMode('account');
    setDirty(false);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const address = fieldsToAddress(fields);
    // Hard-required guard (browser `required` should already catch these).
    for (const k of ['line1', 'city', 'postcode', 'country']) {
      if (!address[k]) {
        setError('Please complete the required address fields.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(address, fields.poNumber.trim());
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err) {
      setError(err?.message || 'Could not save delivery details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const labelCls = 'block text-sm font-medium text-gray-700 mb-1';
  const inputCls =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  const req = <span className="text-red-500">*</span>;

  // ---- Account-preview mode (Quotes, toggle OFF) ----
  if (showAccountToggle && mode === 'account') {
    const snap = buildAccountSnapshot(accountProfile);
    return (
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="h-4 w-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-800">Delivery address</h4>
        </div>
        {hasAccountAddr ? (
          <>
            <div className="text-sm text-gray-600 leading-relaxed">
              {snap.company && <div>{snap.company}</div>}
              {snap.fao && <div>FAO: {snap.fao}</div>}
              <div>{snap.line1}</div>
              {snap.line2 && <div>{snap.line2}</div>}
              <div>{[snap.city, snap.postcode].filter(Boolean).join(', ')}</div>
              <div>{snap.country}</div>
              {snap.phone && <div>Phone: {snap.phone}</div>}
            </div>
            <p className="text-xs text-gray-400 mt-2">Using your account address.</p>
          </>
        ) : (
          <p className="text-sm text-gray-500">No account address saved.</p>
        )}
        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={false}
            onChange={switchToCustom}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Deliver to a different address</span>
        </label>
      </div>
    );
  }

  // ---- Field-entry mode (Quotes toggle ON, or order edit) ----
  return (
    <form onSubmit={handleSubmit} className="border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-800">Delivery address</h4>
        </div>
        {showAccountToggle && hasAccountAddr && (
          <button
            type="button"
            onClick={switchToAccount}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            Use account address
          </button>
        )}
      </div>

      {showAccountToggle && !hasAccountAddr && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          Your account has no saved address — please enter a delivery address below.
        </p>
      )}

      <div>
        <label className={labelCls}>Receiving company name</label>
        <input className={inputCls} value={fields.company} onChange={(e) => setField('company', e.target.value)} placeholder="Acme Corporation" />
      </div>

      <div>
        <label className={labelCls}>FAO / Contact name {req}</label>
        <input className={inputCls} value={fields.fao} onChange={(e) => setField('fao', e.target.value)} placeholder="Jane Smith" />
        <p className="text-xs text-gray-400 mt-1">Required before your order can be approved.</p>
      </div>

      <div>
        <label className={labelCls}>Address line 1 {req}</label>
        <input className={inputCls} required value={fields.line1} onChange={(e) => setField('line1', e.target.value)} placeholder="123 High Street" />
      </div>

      <div>
        <label className={labelCls}>Address line 2</label>
        <input className={inputCls} value={fields.line2} onChange={(e) => setField('line2', e.target.value)} placeholder="Unit 4B" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>City {req}</label>
          <input className={inputCls} required value={fields.city} onChange={(e) => setField('city', e.target.value)} placeholder="London" />
        </div>
        <div>
          <label className={labelCls}>County</label>
          <input className={inputCls} value={fields.county} onChange={(e) => setField('county', e.target.value)} placeholder="Greater London" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Postcode {req}</label>
          <input className={inputCls} required value={fields.postcode} onChange={(e) => setField('postcode', e.target.value)} placeholder="SW1A 1AA" />
        </div>
        <div>
          <label className={labelCls}>Country {req}</label>
          <select className={inputCls} required value={fields.country} onChange={(e) => setField('country', e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Delivery phone {req}</label>
        <input className={inputCls} type="tel" value={fields.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="01234 567890" />
        <p className="text-xs text-gray-400 mt-1">Required before your order can be approved (couriers need it).</p>
      </div>

      <div>
        <label className={labelCls}>Delivery instructions</label>
        <textarea className={inputCls} rows={2} value={fields.instructions} onChange={(e) => setField('instructions', e.target.value)} placeholder="e.g. deliver to reception, ask for the events team" />
      </div>

      <div>
        <label className={labelCls}>Your PO number</label>
        <input className={inputCls} value={fields.poNumber} onChange={(e) => setField('poNumber', e.target.value)} placeholder="Optional — your purchase order reference" />
      </div>

      {error && (
        <p className="text-sm text-red-600 flex items-center gap-1">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader className="h-4 w-4 animate-spin" /> : saveLabel}
        </button>
        {savedFlash && (
          <span className="text-sm text-green-600 font-medium flex items-center gap-1">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </form>
  );
};

export default DeliveryAddressForm;
