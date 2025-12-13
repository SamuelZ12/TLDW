-- Add newsletter_subscribed column to profiles table
ALTER TABLE profiles
ADD COLUMN newsletter_subscribed BOOLEAN DEFAULT true;

-- Update the column for existing users to true (though DEFAULT handles new rows, existing rows should be set)
UPDATE profiles
SET newsletter_subscribed = true
WHERE newsletter_subscribed IS NULL;
