# Securing Appwrite Database Permissions

## Critical: Your database is currently OPEN to anyone!

This guide shows you how to lock down your Appwrite collections so only authenticated users can access their own data.

## Step-by-Step: Configure Appwrite Console

### 1. Login to Appwrite Console
Go to: https://cloud.appwrite.io

### 2. Navigate to Your Database
Project: budget-app → Databases → (your database) → Collections

---

### 3. Configure Each Collection

Do this for EACH collection:

#### **Transactions Collection**

**Settings → Permissions**

1. **DELETE ALL existing permissions** (the `*` "anyone" rules)
2. **Add these permissions:**

| Permission Type | Role | Description |
|----------------|------|-------------|
| Read | `user` | Any authenticated user can read |
| Create | `user` | Any authenticated user can create |
| Update | `user` | Any authenticated user can update |
| Delete | `user` | Any authenticated user can delete |

**IMPORTANT:** 
- Select "Any authenticated user" role (shows as `users` in Appwrite)
- We'll use document-level permissions in code to restrict to owner only

---

#### **Budgets Collection**
Same as Transactions:
- Read: `users` (any authenticated)
- Create: `users`
- Update: `users`
- Delete: `users`

---

#### **Balances Collection**
Same as Transactions:
- Read: `users`
- Create: `users`
- Update: `users`
- Delete: `users`

---

#### **Categories Collection**
- Read: `users` (any authenticated user can read categories)
- Create: `users` (any authenticated user can create)
- Update: `users`
- Delete: `users`

---

#### **Merchant Votes Collection**
- Read: `users` (any authenticated user can see votes)
- Create: `users`
- Update: `users`
- Delete: `users`

---

#### **Users Collection**
- Read: `users` (authenticated users can read profiles)
- Create: `users`
- Update: `users`
- Delete: `users`

---

## What This Does

### BEFORE (Dangerous):
```
Anyone on the internet → Can read/write ALL data
```

### AFTER (Secure):
```
Unauthenticated users → ❌ No access
Authenticated users → ✅ Can access their own data only
```

## Important Notes

1. **This requires authentication** - Users MUST be logged in via Appwrite Auth
2. **Document-level permissions** - We'll add code to restrict each document to its owner
3. **Existing data** - Old documents may not have proper permissions; you may need to migrate
4. **Testing** - After changes, test that:
   - Logged out users can't access anything
   - Users can only see their own data

## Code Changes Needed

Your code already includes `userId` in documents, which is good! 

You'll need to:
1. Import `Permission` and `Role` from Appwrite SDK
2. Add permissions when creating documents
3. Ensure queries filter by userId

I can help implement these code changes if needed.

## Quick Test

After configuring permissions:

1. Try accessing Appwrite without being logged in → Should fail
2. Login as User A → Should only see User A's data  
3. Try to access User B's document ID directly → Should fail

## Verification

Run this test in your app:
```javascript
// This should FAIL if not logged in
await databases.listDocuments(databaseId, transactionsTableId);

// This should only return YOUR transactions
await databases.listDocuments(databaseId, transactionsTableId, [
  Query.equal("userId", currentUser.$id)
]);
```

---

**WARNING:** Your users' financial data is currently exposed. Complete this ASAP!
