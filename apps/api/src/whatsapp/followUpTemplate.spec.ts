import {
  FOLLOW_UP_UNKNOWN_NAME,
  buildFollowUpTemplateMessage,
} from './followUpTemplate';

describe('buildFollowUpTemplateMessage', () => {
  it("uses the client's full name for {{1}}", () => {
    const result = buildFollowUpTemplateMessage({
      firstName: 'Jhon Alex',
      lastName: 'Castaño',
    });

    expect(result.bodyParameters).toEqual(['Jhon Alex Castaño']);
    expect(result.messageContent).toBe(
      'Cordial saludo, Jhon Alex Castaño.\n\n' +
        'Seguimos atentos a su solicitud con IMPROCRÉDITO. Por favor, respóndanos a este mensaje para que un asesor pueda continuar ayudándole. 🤝',
    );
  });

  it('falls back to Señor(a) for an unrecognized number', () => {
    const result = buildFollowUpTemplateMessage(null);

    expect(result.bodyParameters).toEqual([FOLLOW_UP_UNKNOWN_NAME]);
    expect(result.messageContent).toMatch(/^Cordial saludo, Señor\(a\)\./);
  });

  it('falls back to Señor(a) when the client has no name on file', () => {
    const result = buildFollowUpTemplateMessage({
      firstName: ' ',
      lastName: '',
    });

    expect(result.bodyParameters).toEqual([FOLLOW_UP_UNKNOWN_NAME]);
  });

  it('collapses stray whitespace between name parts', () => {
    const result = buildFollowUpTemplateMessage({
      firstName: 'Ana ',
      lastName: ' Gómez',
    });

    expect(result.bodyParameters).toEqual(['Ana Gómez']);
  });
});
