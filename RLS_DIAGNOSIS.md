# RLS Diagnosis for product_templates Query Issue

## Issue Summary

**Problem**: Query to `product_templates` table hangs indefinitely with no network request sent to Supabase.

**Symptoms**:
- Console shows query starting but never completing
- Network tab shows NO request to `/rest/v1/product_templates`
- Other Supabase queries (e.g., `user_designs`) work fine
- Suggests RLS (Row Level Security) policy issue or table access problem

## Diagnostic Tests Implemented

### Test 1: Service Role Bypass
**Location**: `src/services/supabaseService.js` - `testProductTemplatesWithServiceRole()`

This test function creates a separate Supabase client using the **service role key** which bypasses all RLS policies.

**Expected Outcomes**:
- ✅ **If service role test succeeds**: RLS policy is blocking anonymous access
- ❌ **If service role test fails too**: Deeper issue (table doesn't exist, permissions, etc.)

### Test 2: Minimal Query
**Location**: `src/services/supabaseService.js` - `getProductTemplates()`

Replaced complex query with absolute minimal version:
```javascript
const { data, error } = await client.from('product_templates').select('*');
```

**What was removed**:
- `.order('created_at', { ascending: false})` clause
- All intermediate variable assignments
- Promise.race timeout wrapper

**Expected Outcomes**:
- ✅ **If minimal query works**: `.order()` clause was the problem
- ❌ **If minimal query hangs**: Issue is with basic table access

## Required: Manual RLS Check in Supabase Dashboard

Since I cannot access the Supabase dashboard directly, please manually check:

### Step 1: Navigate to Table Settings
1. Go to: https://app.supabase.com/project/cbcevjhvgmxrxeeyldza
2. Click **Database** in left sidebar
3. Click **Tables**
4. Find and click on **product_templates** table

### Step 2: Check RLS Status
Look for the RLS toggle at the top of the table view:
- 🔴 **RLS Enabled**: This could be blocking queries
- 🟢 **RLS Disabled**: Not an RLS issue

### Step 3: Check RLS Policies (if RLS is enabled)
1. Click the **Policies** tab for the `product_templates` table
2. Look for policies with the following:
   - **Command**: SELECT
   - **Role**: anon (for anonymous access) or public
   - **Policy definition**: Should allow reading product templates

### Step 4: Check Other Tables for Comparison
Check the `user_designs` table (which works):
1. Navigate to **user_designs** table
2. Check if RLS is enabled
3. If enabled, check what SELECT policies exist
4. Compare with `product_templates` policies

## Environment Variable Check

The service role test requires `VITE_SUPABASE_SERVICE_ROLE_KEY` in your `.env` file.

**Check your `.env` file has**:
```
VITE_SUPABASE_URL=https://cbcevjhvgmxrxeeyldza.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**To get the service role key**:
1. Go to: https://app.supabase.com/project/cbcevjhvgmxrxeeyldza/settings/api
2. Under "Project API keys"
3. Look for **service_role** key (⚠️ This is secret - never commit to git!)
4. Copy and add to `.env`

## Expected Console Output

When you refresh the Designer page, you should see:

```
[Designer] 🔄 STARTING loadProductsFromDatabase()
[Designer] 🧪 Testing service role access...
[TEST] Testing product_templates access with service role...
[TEST] Service role client created
[TEST] ✅ Query completed!
[TEST] Result: { data: [...], error: null }
[Designer] 🧪 Test result: { data: [...], error: null }
[Designer] 📡 Calling getProductTemplates()...
[getProductTemplates] 🚀 Starting...
[getProductTemplates] Client obtained
[getProductTemplates] About to query...
[getProductTemplates] ✅ Query returned! { data: [...], error: ... }
```

## Diagnosis Scenarios

### Scenario A: Service Role Works, Normal Query Fails
```
[TEST] ✅ Query completed! (3 products)
[getProductTemplates] ❌ Query hangs or returns error
```
**Diagnosis**: RLS policy issue
**Solution**:
1. Disable RLS on `product_templates` table, OR
2. Add policy: `CREATE POLICY "Allow public read" ON product_templates FOR SELECT TO anon USING (true);`

### Scenario B: Both Service Role and Normal Query Fail
```
[TEST] ❌ Error: relation "product_templates" does not exist
[getProductTemplates] ❌ Same error
```
**Diagnosis**: Table doesn't exist or database connection issue
**Solution**: Run migrations to create table

### Scenario C: Service Role Fails Due to Missing Key
```
[TEST] No service role key found in .env
```
**Diagnosis**: Environment variable not set
**Solution**: Add `VITE_SUPABASE_SERVICE_ROLE_KEY` to `.env` file

### Scenario D: Both Queries Work
```
[TEST] ✅ Query completed! (3 products)
[getProductTemplates] ✅ Query returned! (3 products)
```
**Diagnosis**: Issue was with `.order()` clause or Promise.race wrapper
**Solution**: Keep the minimal query version

## Next Steps After Testing

1. **Refresh Designer page**: http://localhost:3002/designer
2. **Open browser console**: Check for the diagnostic output above
3. **Check Network tab**: Look for requests to `/rest/v1/product_templates`
4. **Report findings**:
   - Did service role test work?
   - Did normal query work?
   - What error messages appeared?
   - What does Network tab show?

## Files Modified for Diagnostics

1. **src/services/supabaseService.js**
   - Added: `testProductTemplatesWithServiceRole()` function
   - Modified: `getProductTemplates()` to minimal version

2. **src/pages/Designer.jsx**
   - Added: Service role test call before normal query
   - Added: Import for test function

3. **This file**: RLS_DIAGNOSIS.md
   - Documents the diagnostic approach and expected outcomes

---

**⚠️ IMPORTANT**: The test function and service role key are for diagnostics only. Remove them before deploying to production!
