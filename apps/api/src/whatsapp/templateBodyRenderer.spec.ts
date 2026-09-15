import { renderTemplateBody } from './templateBodyRenderer';

describe('renderTemplateBody', () => {
  it('substitutes each placeholder with its matching parameter, in order', () => {
    const content = 'Cordial saludo, *{{1}}*. Su cuota {{2}} vence el {{3}}.';

    const result = renderTemplateBody(content, [
      'Juana Pérez',
      '7',
      '15/09/2026',
    ]);

    expect(result).toBe(
      'Cordial saludo, *Juana Pérez*. Su cuota 7 vence el 15/09/2026.',
    );
  });

  it('does not let a double-digit placeholder collide with a single-digit one', () => {
    const content = 'Van {{1}} de {{10}} y {{11}} cuotas.';

    const result = renderTemplateBody(content, [
      '3',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
    ]);

    expect(result).toBe('Van 3 de 10 y 11 cuotas.');
  });

  it('replaces every occurrence when the same placeholder appears more than once', () => {
    const content = '{{1}} y otra vez {{1}}.';

    const result = renderTemplateBody(content, ['hola']);

    expect(result).toBe('hola y otra vez hola.');
  });

  it('leaves fixed template text untouched', () => {
    const content = 'Que tenga un feliz día. 🤝 {{1}}';

    const result = renderTemplateBody(content, ['Gracias.']);

    expect(result).toBe('Que tenga un feliz día. 🤝 Gracias.');
  });
});
