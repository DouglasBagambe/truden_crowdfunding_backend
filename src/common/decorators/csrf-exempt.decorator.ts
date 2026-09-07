import { SetMetadata } from '@nestjs/common';

export const IS_CSRF_EXEMPT = 'isCsrfExempt';
export const CsrfExempt = () => SetMetadata(IS_CSRF_EXEMPT, true);
