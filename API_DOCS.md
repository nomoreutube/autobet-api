# Autobet API Documentation

## New Endpoints

### 1. Check Connection Status
**Endpoint:** `POST /api/check-connection`

**Purpose:** Detects if the user is disconnected by analyzing a screenshot

**Request:**
```json
{
  "image": "base64_image_string",
  "id": "user_id"
}
```

**Response:**
```json
{
  "needRefresh": true
}
```
- `needRefresh: true` = User is disconnected, refresh needed
- `needRefresh: false` = Connection is normal

**Error Responses:**
- `400` - Missing image or user ID
- `404` - User not found
- `500` - Server error

---

### 2. Check Betting Availability
**Endpoint:** `POST /api/check-betting`

**Purpose:** Determines if betting is allowed based on timer and betting text in screenshot

**Request:**
```json
{
  "image": "base64_image_string",
  "id": "user_id"
}
```

**Response:**
```json
{
  "canBet": true
}
```
- `canBet: true` = Betting is allowed (timer ≥12s + "start betting" text OR "preparing" + timer=0)
- `canBet: false` = Betting not allowed

**Error Responses:**
- `400` - Missing image or user ID
- `404` - User not found
- `500` - Server error

---

## Updated Existing Endpoints

### Chat Endpoint
**Endpoint:** `POST /api/chat`

**Changes:** Now requires `id` parameter and returns user balance

**Request:**
```json
{
  "image": "base64_image_string",
  "id": "user_id"
}
```

**Response:**
```json
{
  "red": 5,
  "black": 10,
  "balance": 25.75
}
```

### Balance Endpoint
**Endpoint:** `GET /api/balance?id=user_id`

**Purpose:** Get user's current balance

**Response:**
```json
{
  "balance": 25.75
}
```

---

## Notes for Frontend Implementation

1. **User ID Required:** All endpoints now require a valid user ID
2. **Error Handling:** Always check for 404 "User not found" errors
3. **Image Format:** Send images as base64 strings (with or without data URI prefix)
4. **Balance Tracking:** Chat endpoint increments balance by 1 on each call
5. **Connection Monitoring:** Use check-connection endpoint to detect disconnects
6. **Betting Logic:** Use check-betting endpoint before allowing bets