import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CharityCategory } from '../../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../../common/enums/charity-subcategory.enum';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { CreateProjectDto } from './create-project.dto';

const validPayload = {
  type: ProjectType.CHARITY,
  name: 'Community water access',
  summary: 'A clean water campaign for local families.',
  story: 'This campaign will provide reliable clean water access to families.',
  country: 'Uganda',
  beneficiary: 'Community families',
  paymentMethod: 'Mobile Money',
  category: CharityCategory.COMMUNITY_GROUP,
  subcategory: CharitySubcategory.OUTREACH,
  targetAmount: 250000,
  currency: 'UGX',
};

describe('CreateProjectDto date transport contract', () => {
  it('accepts an ISO-8601 funding date as JSON text', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...validPayload,
      fundingEndDate: '2099-12-31T23:59:59.999Z',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.fundingEndDate).toBe('2099-12-31T23:59:59.999Z');
  });

  it('rejects a malformed funding date before it reaches persistence', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      ...validPayload,
      fundingEndDate: 'not-a-date',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'fundingEndDate')).toBe(
      true,
    );
  });
});
