/** Files of the operating system itself: stopping or cutting them off can take the computer down. */
export const systemFile = (path: string) => /^([a-z]:\\windows\\|\/(System|usr\/libexec|usr\/lib|usr\/sbin|sbin|lib)\/)/i.test(path)
