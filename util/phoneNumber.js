// util/phoneNumber.js

// Funkcja konwertująca cyfry na słowa w języku polskim
const digitToWord = {
  '0': 'zero',
  '1': 'jeden',
  '2': 'dwa',
  '3': 'trzy',
  '4': 'cztery',
  '5': 'pięć',
  '6': 'sześć',
  '7': 'siedem',
  '8': 'osiem',
  '9': 'dziewięć'
};

// Funkcja konwertująca numer telefonu na słowa
export function convertPhoneNumberToWords(phoneNumber) {
  return phoneNumber
    .split('')
    .map(char => digitToWord[char] || char)
    .join(' ');
}

// Definicja narzędzia funkcji dla OpenAI API
export const phoneNumberTool = {
  type: 'function',
  name: 'PhoneNumber',
  description: 'Używaj tego narzędzia za każdym razem kiedy wykryjesz numer telefonu',
  parameters: {
    type: 'object',
    properties: {
      phone_number: {
        type: 'string',
        description: 'Numer telefonu.',
      },
    },
    required: ['phone_number']
  }
};
