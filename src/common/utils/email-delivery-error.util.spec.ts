import { emailDeliveryFailure } from './email-delivery-error.util';

describe('safe email diagnostics', () => {
  it('identifies sender rejection without exposing the rejected address or payload', () => {
    const result = emailDeliveryFailure({
      response: {
        statusCode: 403,
        body: {
          errors: [
            {
              message:
                'from address secret@example.com does not match a verified Sender Identity; token=private',
            },
          ],
        },
      },
    });
    expect(result).toBe('status=403; reason=sender_identity');
    expect(result).not.toMatch(/secret|private|token|@/);
  });
  it.each([undefined, null, 'private-key', { code: 'ECONNREFUSED' }])(
    'handles unknown failures without echoing input %#',
    (error) => {
      expect(emailDeliveryFailure(error)).toBe(
        'status=unknown; reason=provider_rejected',
      );
    },
  );
});
