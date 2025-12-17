
# Supabase Setup Guide

This document provides instructions for setting up Supabase for the Print Area Configuration system.

## Prerequisites

1. Create a Supabase account at https://supabase.com
2. Create a new project in Supabase

## Step 1: Get Your Credentials

1. Go to your Supabase project dashboard
2. Navigate to Settings > API
3. Copy the Project URL and the anon/public key
4. Create a `.env` file in the root of your project
5. Add your credentials:

```bash
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## Step 2: Run Database Migrations

1. Go to the SQL Editor in your Supabase dashboard
2. Create a new query
3. Copy and paste the content from `supabase/schema.sql`
4. Run the query to create all necessary tables and policies

## Step 3: Set Up Storage

1. Go to Storage in your Supabase dashboard
2. Create a new bucket called `product-templates`
3. Set the bucket to **public** access
4. Configure CORS if needed

## Step 4: Create Admin Users

To mark a user as admin:

1. Sign up a user through your application
2. Go to Authentication > Users in Supabase dashboard
3. Find the user and copy their ID
4. Go to SQL Editor and run:

```sql
UPDATE auth.users 
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{is_admin}',
  'true'::jsonb
)
WHERE id = 'user-id-here';
```

## Step 5: Test the Connection

1. Start your development server: `npm run dev`
2. Try signing in with a user
3. If the user is an admin, they should see the Print Area Admin option

## Database Schema Overview

### Tables

- **product_templates**: Stores product configurations
  - id (UUID, primary key)
  - product_key (TEXT, unique)
  - name (TEXT)
  - template_url (TEXT)
  - colors (JSONB)
  - base_price (DECIMAL)
  - created_by (UUID, foreign key to auth.users)
  - created_at (TIMESTAMP)
  - updated_at (TIMESTAMP)

- **print_areas**: Stores print area configurations for each product
  - id (UUID, primary key)
  - product_template_id (UUID, foreign key to product_templates)
  - area_key (TEXT)
  - name (TEXT)
  - x (INTEGER)
  - y (INTEGER)
  - width (INTEGER)
  - height (INTEGER)
  - max_width (INTEGER)
  - max_height (INTEGER)
  - created_at (TIMESTAMP)
  - updated_at (TIMESTAMP)

### Row Level Security (RLS)

- All users can read product templates and print areas
- Only admins can create, update, or delete product templates and print areas

## Troubleshooting

### Mock Auth Still Active

If the system is still using mock authentication:
- Check that your `.env` file exists and has valid credentials
- Verify the environment variables are prefixed with `VITE_`
- Restart your development server after adding environment variables

### Cannot Save Print Areas

- Verify you're signed in as an admin user
- Check the browser console for errors
- Verify RLS policies are set up correctly in Supabase

### Template Images Not Loading

- Verify the `product-templates` storage bucket exists
- Check that the bucket is set to public access
- Verify the template URL is correct in the database
