# Quick Start - Testing Your Print Area Configuration System

## ✅ What's Been Done

The complete Supabase backend persistence implementation has been pushed to GitHub! Here's what's ready:

### 1. Code Changes Pushed
- ✅ Updated `.env.example` with working Supabase credentials
- ✅ Created comprehensive `SETUP_INSTRUCTIONS.md`
- ✅ All backend persistence code already implemented (in previous commits)

### 2. Pull Request Created
- **PR #24**: [Add Supabase Backend Persistence for Print Area Configuration](https://github.com/PGifts2025/site/pull/24)
- Branch: `fix-printarea-drag-20251013-155701`
- Status: Open and ready for review/merge

---

## 🚀 How to Test Right Now

### Step 1: Pull the Latest Changes

```bash
# Navigate to your project
cd /path/to/your/site

# Fetch the latest changes
git fetch origin

# Checkout the feature branch
git checkout fix-printarea-drag-20251013-155701

# Pull the latest commits
git pull origin fix-printarea-drag-20251013-155701
```

### Step 2: Set Up Environment

```bash
# Copy the environment file
cp .env.example .env

# The .env.example already contains working Supabase credentials!
# You can use them as-is for testing, or replace with your own
```

### Step 3: Install Dependencies (if needed)

```bash
npm install
```

### Step 4: Set Up Supabase Database

**Option A: Use the Existing Supabase Project (Fastest)**
The credentials in `.env.example` are for an existing Supabase project. If you want to use it:
1. The database schema should already be applied
2. You just need to create your user account

**Option B: Use Your Own Supabase Project**
1. Go to https://supabase.com and create a new project
2. Update the `.env` file with your own credentials
3. Run the database schema:
   - Open Supabase Dashboard → SQL Editor
   - Copy content from `supabase/schema.sql`
   - Paste and run it

### Step 5: Create Storage Bucket

In your Supabase Dashboard:
1. Go to **Storage** → **Create bucket**
2. Name: `product-templates`
3. Set to **Public**
4. Click **Create**

### Step 6: Start the Application

```bash
npm run dev
```

The app will be available at: **http://localhost:3000**

### Step 7: Sign Up and Test

1. **Sign Up**: Go to http://localhost:3000 and create a new account
   - Email: `admin@test.com` (or any email you like)
   - Password: (any password)

2. **Make Yourself Admin**:
   - Go to Supabase Dashboard → **Authentication** → **Users**
   - Find your user and copy the User ID
   - Go to **SQL Editor** and run:
   ```sql
   UPDATE auth.users 
   SET raw_user_meta_data = jsonb_set(
     COALESCE(raw_user_meta_data, '{}'::jsonb),
     '{is_admin}',
     'true'::jsonb
   )
   WHERE id = 'YOUR_USER_ID_HERE';
   ```
   - Sign out and sign in again

3. **Test the Print Area Configuration**:
   - Navigate to: http://localhost:3000/enhanced-designer
   - Click the **⚙️ Settings** button (or look for "Print Area Admin")
   - You should see the Print Area Configuration modal
   - Select "Tote Bag" or another product
   - Try these features:
     - ✅ Drag and resize the print areas
     - ✅ Upload a new template image
     - ✅ Add a new print area
     - ✅ Click **Save** to persist to database
     - ✅ Refresh the page and verify it loads from database

---

## 🎯 Expected Behavior

### ✅ What Should Work
1. **Authentication**: Sign up, sign in, sign out
2. **Admin Check**: Admin users can access Print Area Configuration
3. **Load Configuration**: Existing products load from Supabase (or fallback to products.json)
4. **Save Configuration**: Changes persist to database
5. **Upload Images**: Template images upload to Supabase Storage
6. **CRUD Operations**: Create, read, update, delete print areas
7. **Visual Feedback**: Loading states, success messages, error messages

### ⚠️ Important Notes
- **First time users**: If no data in Supabase, system falls back to `products.json`
- **Admin required**: Only admin users can save configurations
- **Public read**: Anyone can view products and print areas
- **Image storage**: Template images must be uploaded to see them in the designer

---

## 📖 Full Documentation

For complete setup instructions, see: **`SETUP_INSTRUCTIONS.md`**

It includes:
- Step-by-step Supabase project setup
- Database schema explanation
- Detailed testing instructions
- Troubleshooting guide
- System architecture overview

---

## 🔍 Troubleshooting

### "Cannot read properties of undefined"
- Make sure `.env` file exists
- Restart the dev server after creating `.env`

### "Only administrators can save"
- Verify you've set `is_admin: true` in user metadata
- Sign out and sign in again

### Template images not loading
- Check the storage bucket exists and is public
- Verify the template URL in the database

### Still using mock auth
- Check `VITE_SUPABASE_URL` in `.env` is a valid URL
- Clear browser localStorage: `localStorage.clear()`
- Restart dev server

---

## 🎉 Next Steps

1. **Test the functionality** following the steps above
2. **Review the PR** if everything works
3. **Merge the PR** when you're ready
4. **Configure your products** using the Print Area Admin
5. **Upload real product images** to make it production-ready

---

## 📞 Need Help?

If you encounter issues:
1. Check the browser console for errors
2. Check Supabase dashboard logs
3. Review `SETUP_INSTRUCTIONS.md`
4. Check the code comments in:
   - `src/services/supabaseService.js`
   - `src/components/PrintAreaAdmin.jsx`

---

**You're all set! The code is live on GitHub and ready to test.** 🚀
